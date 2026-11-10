import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { EmployeeFull } from '../../../../core/models/employee';
import { EmployeeRequest, Invite } from '../../../../core/models/office-records';
import { OfficeContext } from '../../../office/office-context.service';
import { sortRequests } from '../../../requests/logic/request-model';
import { RequestService } from '../../../requests/request.service';
import { InviteService } from '../../invite.service';
import { inviteState, inviteUrl } from '../../logic/invite';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 従業員の詳細に出す「マイページ」：招待の状態と、その人への依頼・その人からの申請
 * - 結びついていない → 招待を作る（メールは連絡先のメールを初期値に）
 * - 招待中 → リンクをコピー・取り消し
 * - 結びついている → アカウントあり
 */
@Component({
  selector: 'app-my-page-card',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './my-page-card.html',
  styleUrl: './my-page-card.css',
})
export class MyPageCard implements OnInit {
  private readonly invites = inject(InviteService);
  private readonly requestsApi = inject(RequestService);
  readonly context = inject(OfficeContext);

  readonly employee = input.required<EmployeeFull>();

  readonly list = signal<Invite[]>([]);
  readonly requests = signal<EmployeeRequest[]>([]);
  readonly loading = signal(true);
  readonly working = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly copied = signal(false);
  readonly email = signal('');

  readonly now = Date.now();
  /** 使える招待（新しいもの1つ） */
  readonly active = computed(() =>
    this.list().find((i) => inviteState({ usedBy: i.usedBy, expiresMs: i.expiresAt.toMillis() }, this.now) === 'usable') ?? null,
  );
  readonly linked = computed(() => !!this.employee().userUid);
  readonly emailValid = computed(() => this.email().trim() === '' || EMAIL_RE.test(this.email().trim()));
  readonly link = computed(() => {
    const a = this.active();
    const officeId = this.context.current()?.id;
    return a && officeId ? inviteUrl(location.origin, officeId, a.code) : '';
  });
  readonly sortedRequests = computed(() =>
    sortRequests(this.requests().map((r) => ({ ...r, updatedMs: r.updatedAt?.toMillis() ?? 0 }))),
  );

  ngOnInit(): void {
    this.email.set(this.employee().contact?.email ?? '');
    this.load();
  }

  private async load(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || !this.context.isAdmin()) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      const [list, requests] = await Promise.all([
        this.invites.listFor(officeId, this.employee().id),
        this.requestsApi.listFor(officeId, this.employee().id),
      ]);
      this.list.set(list);
      this.requests.set(requests);
    } catch (err) {
      console.error(err);
      this.errorKey.set('myPageCard.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  async invite(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || !this.emailValid() || this.working()) return;
    this.working.set(true);
    this.errorKey.set(null);
    try {
      const inv = await this.invites.create(officeId, this.employee().id, this.email().trim() || null);
      this.list.update((l) => [inv, ...l]);
    } catch (err) {
      console.error(err);
      this.errorKey.set('myPageCard.error.create');
    } finally {
      this.working.set(false);
    }
  }

  async revoke(code: string): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || this.working()) return;
    this.working.set(true);
    try {
      await this.invites.revoke(officeId, code);
      this.list.update((l) => l.filter((i) => i.code !== code));
    } catch (err) {
      console.error(err);
      this.errorKey.set('myPageCard.error.revoke');
    } finally {
      this.working.set(false);
    }
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.link());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // クリップボードが使えない（http など）ときは、表示されたリンクを手で選んでもらう
    }
  }

  expires(i: Invite): string {
    return i.expiresAt.toDate().toLocaleDateString();
  }
}
