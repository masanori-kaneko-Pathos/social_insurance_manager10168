import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { Invite } from '../../../../core/models/office-records';
import { PersonListBar } from '../../../../shared/components/person-list-bar/person-list-bar';
import { downloadCsv } from '../../../../shared/csv/csv';
import { defaultListOptions, filterAndSort, pageOf, PersonListOptions } from '../../../../shared/logic/person-list';
import { todayLocal } from '../../../../shared/utils/date';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import { InviteService } from '../../invite.service';
import { inviteUrl } from '../../logic/invite';
import {
  canBulkInvite,
  contactEmailOf,
  InviteLike,
  MyPageStatus,
  myPageStatus,
  splitForInvite,
  usableInviteOf,
} from '../../logic/my-page-status';

interface Row {
  employee: Employee;
  status: MyPageStatus;
  invite: InviteLike | null; // 使える招待
  selectable: boolean;
}

/** 1ページの人数（招待は人を選ぶだけの軽い表なので、給与の入力より多めに） */
const PAGE_SIZE = 100;

/** 招待を作った結果（画面に出す） */
interface Result {
  made: number;
  noEmail: string[]; // アドレスがなくて飛ばした人の名前
}

/**
 * 従業員マイページ：在籍中の全員の状態（アカウントあり・招待中・なし）と、まとめて招待
 * - 一覧の読み込みは、招待の問い合わせ1回だけ（従業員は親の画面で読んだものを使う）
 * - 連絡先のメールは鍵付きの文書にあるので、「招待する」を押したときに選んだ人の分だけ読む
 * - メールは送らない。リンクを CSV で書き出して、差し込みメールなどで送ってもらう
 * - 探す・並べる・ページは給与の入力と同じ帯（契約は読まないので雇用形態の絞り込みは出さない）。11/12
 * - 選んだ人は、絞り込みやページを変えても残る
 */
@Component({
  selector: 'app-my-page-invites',
  imports: [RouterLink, TranslocoPipe, PersonListBar],
  templateUrl: './my-page-invites.html',
  styleUrl: './my-page-invites.css',
})
export class MyPageInvites implements OnInit {
  private readonly invitesApi = inject(InviteService);
  private readonly employeesApi = inject(EmployeeService);
  private readonly transloco = inject(TranslocoService);
  readonly context = inject(OfficeContext);

  /** 親の画面で読んだ従業員（全員。退職した人はここで外す） */
  readonly employees = input.required<Employee[]>();

  readonly statuses: readonly MyPageStatus[] = ['linked', 'invited', 'expired', 'none'];
  private readonly invites = signal<Invite[]>([]);
  readonly loading = signal(true);
  readonly working = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly result = signal<Result | null>(null);
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly copiedId = signal<string | null>(null);

  // ===== 探す・絞る・並べる・ページ =====
  readonly listOptions = signal<PersonListOptions>(defaultListOptions());
  readonly page = signal(1);
  /** マイページの状態で絞る（all ＝ すべて） */
  readonly statusFilter = signal<MyPageStatus | 'all'>('all');

  private readonly now = Date.now();
  private readonly today = todayLocal();

  private readonly inviteLikes = computed<InviteLike[]>(() =>
    this.invites().map((i) => ({
      code: i.code,
      employeeId: i.employeeId,
      email: i.email,
      usedBy: i.usedBy,
      expiresMs: i.expiresAt.toMillis(),
    })),
  );

  readonly rows = computed<Row[]>(() => {
    const invites = this.inviteLikes();
    return this.employees()
      .filter((e) => !e.retireDate || e.retireDate >= this.today)
      .map((employee) => ({
        employee,
        status: myPageStatus(employee, invites, this.now),
        invite: usableInviteOf(employee.id, invites, this.now),
        selectable: canBulkInvite(employee, invites, this.now),
      }));
  });

  readonly counts = computed(() => {
    const c: Record<MyPageStatus, number> = { linked: 0, invited: 0, expired: 0, none: 0 };
    for (const r of this.rows()) c[r.status]++;
    return c;
  });

  /** 状態で絞ってから、名前で探して並べる */
  readonly filtered = computed(() => {
    const st = this.statusFilter();
    const rows = st === 'all' ? this.rows() : this.rows().filter((r) => r.status === st);
    return filterAndSort(rows, this.listOptions(), (r) => r.employee, () => null, () => false);
  });
  readonly shown = computed(() => pageOf(this.filtered(), this.page(), PAGE_SIZE));

  /** 見出しのチェック：今のページの選べる人 */
  readonly selectableIds = computed(() => this.shown().rows.filter((r) => r.selectable).map((r) => r.employee.id));
  readonly allSelected = computed(
    () => this.selectableIds().length > 0 && this.selectableIds().every((id) => this.selected().has(id)),
  );
  /** 条件に合う選べる人（全ページ） */
  readonly filteredSelectableIds = computed(() =>
    this.filtered().filter((r) => r.selectable).map((r) => r.employee.id),
  );
  readonly invitedRows = computed(() => this.rows().filter((r) => r.invite));

  ngOnInit(): void {
    this.load();
  }

  private async load(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId) return;
    this.loading.set(true);
    try {
      this.invites.set(await this.invitesApi.listEmployeeInvites(officeId));
    } catch (err) {
      console.error(err);
      this.errorKey.set('myPages.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  toggle(id: string): void {
    this.selected.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 今のページの選べる人をまとめて選ぶ／外す（ほかのページで選んだ人はそのまま） */
  toggleAll(): void {
    const ids = this.selectableIds();
    const off = this.allSelected();
    this.selected.update((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (off) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  /** 条件に合う選べる人を、全ページまとめて選ぶ */
  selectFiltered(): void {
    this.selected.update((s) => new Set([...s, ...this.filteredSelectableIds()]));
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  setStatus(value: string): void {
    this.statusFilter.set(value as MyPageStatus | 'all');
    this.page.set(1);
  }

  /** 選んだ人の連絡先のメールを読み、アドレスのある人の招待をまとめて作る */
  async inviteSelected(): Promise<void> {
    const officeId = this.context.current()?.id;
    const ids = this.selected();
    if (!officeId || ids.size === 0 || this.working()) return;
    this.working.set(true);
    this.errorKey.set(null);
    this.result.set(null);
    try {
      const picked = this.rows().filter((r) => r.selectable && ids.has(r.employee.id)).map((r) => r.employee);
      const withContact = await Promise.all(
        picked.map(async (e) => ({ ...e, contact: (await this.employeesApi.getPrivate(officeId, e.id, e)).contact })),
      );
      const { invite, noEmail } = splitForInvite(withContact, this.inviteLikes(), Date.now());
      const made = await this.invitesApi.createMany(
        officeId,
        invite.map((e) => ({ employeeId: e.id, email: contactEmailOf(e)! })),
      );
      this.invites.update((l) => [...made, ...l]);
      this.selected.set(new Set());
      this.result.set({ made: made.length, noEmail: noEmail.map((e) => this.nameOf(e)) });
    } catch (err) {
      console.error(err);
      this.errorKey.set('myPages.error.create');
    } finally {
      this.working.set(false);
    }
  }

  linkOf(r: Row): string {
    const officeId = this.context.current()?.id;
    return r.invite && officeId ? inviteUrl(location.origin, officeId, r.invite.code) : '';
  }

  async copy(r: Row): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.linkOf(r));
      this.copiedId.set(r.employee.id);
      setTimeout(() => this.copiedId.set(null), 2000);
    } catch {
      // クリップボードが使えないとき（http など）は、CSV で書き出してもらう
    }
  }

  /** 招待中の人のリンクを CSV に（社員番号・氏名・アドレス・リンク・期限） */
  exportCsv(): void {
    const t = (k: string) => this.transloco.translate(k);
    const header = ['number', 'name', 'email', 'link', 'expires'].map((k) => t(`myPages.csv.${k}`));
    const rows = this.invitedRows().map((r) => [
      r.employee.employeeNumber ?? '',
      this.nameOf(r.employee),
      r.invite!.email ?? '',
      this.linkOf(r),
      this.dateOf(r.invite!.expiresMs),
    ]);
    downloadCsv(`mypage-invites-${this.today}.csv`, [header, ...rows]);
  }

  nameOf(e: Employee): string {
    return `${e.lastName} ${e.firstName}`.trim();
  }

  dateOf(ms: number): string {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
