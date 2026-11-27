import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { map } from 'rxjs';
import { Employee } from '../../../../core/models/employee';
import { EmployeeRequest, REQUEST_STATUSES, RequestDirection, RequestStatus } from '../../../../core/models/office-records';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import { MyPageInvites } from '../../../invites/components/my-page-invites/my-page-invites';
import { sortRequests } from '../../logic/request-model';
import { RequestService } from '../../request.service';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { PersonName } from '../../../../shared/components/person-name/person-name';
import { EntryChoice, EntryChoiceItem } from '../../../../shared/components/entry-choice/entry-choice';

type Filter = RequestStatus | 'all';
/** 画面の中のタブ：マイページの発行／会社からの依頼／従業員からの申請（11/27。並びは仕事の順） */
export type RequestView = 'requests' | 'applications' | 'invites';

/** タブごとの向き（依頼 ＝ 会社から従業員へ、申請 ＝ 従業員から） */
const DIRECTION_OF: Record<Exclude<RequestView, 'invites'>, RequestDirection> = {
  requests: 'toEmployee',
  applications: 'fromEmployee',
};

/**
 * 従業員マイページ（発行・依頼・申請。確認待ちが上）。タブ（?view=）と状態の絞り込み（?status=）は URL に持つ
 * 11/27：依頼と申請をタブで分けた（向きが逆の仕事が1つの一覧に混ざっていたため。データは direction で分かれている）
 */
@Component({
  selector: 'app-request-list',
  imports: [EntryChoice, PersonName, MyPageInvites, RouterLink, TranslocoPipe],
  templateUrl: './request-list.html',
  styleUrl: '../requests.css',
})
export class RequestList {
  private readonly api = inject(RequestService);
  private readonly employeesApi = inject(EmployeeService);
  private readonly route = inject(ActivatedRoute);
  readonly context = inject(OfficeContext);

  /** 申請には「回答待ち」がない（従業員が出した時点で確認待ち） */
  readonly statuses = computed(() => (this.view() === 'applications' ? REQUEST_STATUSES.filter((s) => s !== 'open') : REQUEST_STATUSES));
  readonly filter = toSignal(
    this.route.queryParamMap.pipe(map((q) => (q.get('status') as Filter | null) ?? 'all')),
    { initialValue: 'all' as Filter },
  );

  /** ?view= の値（なければ null） */
  private readonly viewParam = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('view'))), { initialValue: null });

  /**
   * 発行／依頼／申請（?view=）。指定がなければ左のタブ（管理者は発行、それ以外は依頼。11/27）
   * 発行は管理者だけ。読めない値は依頼
   */
  readonly view = computed((): RequestView => {
    const v = this.viewParam();
    const admin = this.context.isAdmin();
    if (v === 'requests' || v === 'applications') return v;
    if (v === 'invites' || v === null) return admin ? 'invites' : 'requests';
    return 'requests';
  });

  /** 依頼のタブの入り口（依頼を作成。管理者だけ。11/27） */
  readonly entryItems = computed<EntryChoiceItem[]>(() => [
    {
      icon: 'plus',
      titleKey: 'request.entry.new.title',
      noteKey: 'request.entry.new.note',
      link: ['/o', this.context.current()?.id, 'requests', 'new'],
    },
  ]);

  readonly requests = signal<EmployeeRequest[]>([]);
  private readonly employees = signal<Map<string, Employee>>(new Map());
  readonly employeeList = computed(() => [...this.employees().values()]);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);

  /** 今のタブの向きのものだけ（マイページの発行のタブでは使わない） */
  private readonly inView = computed(() => {
    const v = this.view();
    const dir = v === 'invites' ? null : DIRECTION_OF[v];
    return this.requests().filter((r) => r.direction === dir);
  });

  /** タブに添える確認待ちの件数（依頼・申請） */
  readonly pending = computed(() => {
    const n = (dir: RequestDirection) => this.requests().filter((r) => r.direction === dir && r.status === 'submitted').length;
    return { requests: n('toEmployee'), applications: n('fromEmployee') };
  });

  readonly counts = computed(() => {
    const c: Record<string, number> = { all: this.inView().length };
    for (const r of this.inView()) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  });

  readonly rows = computed(() => {
    const f = this.filter();
    const list = this.inView().filter((r) => f === 'all' || r.status === f);
    return sortRequests(list.map((r) => ({ ...r, updatedMs: r.updatedAt?.toMillis() ?? 0 })));
  });

  constructor() {
    effect(() => {
      const office = this.context.current();
      if (office) this.load(office.id);
    });
  }

  private async load(officeId: string): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const [requests, employees] = await Promise.all([this.api.listAll(officeId), this.employeesApi.list(officeId)]);
      this.requests.set(requests);
      this.employees.set(new Map(employees.map((e) => [e.id, e])));
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'request.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  nameOf(employeeId: string): string {
    const e = this.employees().get(employeeId);
    return e ? `${e.lastName} ${e.firstName}`.trim() : '—';
  }

  employeeOf(employeeId: string): Employee | null {
    return this.employees().get(employeeId) ?? null;
  }

  numberOf(employeeId: string): string | null {
    return this.employees().get(employeeId)?.employeeNumber ?? null;
  }

  updated(r: EmployeeRequest): string {
    return r.updatedAt ? r.updatedAt.toDate().toLocaleDateString() : '';
  }
}
