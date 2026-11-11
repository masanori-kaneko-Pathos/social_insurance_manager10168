import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthService } from '../../../../core/auth/auth.service';
import { OfficeRole } from '../../../../core/models/office';
import { Invite } from '../../../../core/models/office-records';
import { ToastService } from '../../../../shared/services/toast.service';
import { joinUrl } from '../../../invites/logic/invite';
import { OfficeContext } from '../../../office/office-context.service';
import { OfficeService } from '../../../office/office.service';
import { MemberAction, MemberService, MemberView, reasonOf } from '../../member.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * メンバー（管理者・一般）：一覧・権限の変更・外す・代表の交代・招待
 * どの操作ができるかは関数が決めて返す（functions/src/member-rules.ts）。画面はボタンを出すだけ
 */
@Component({
  selector: 'app-members',
  imports: [TranslocoPipe],
  templateUrl: './members.html',
  styleUrl: './members.css',
})
export class MembersPage implements OnInit {
  private readonly api = inject(MemberService);
  private readonly offices = inject(OfficeService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly toast = inject(ToastService);
  readonly context = inject(OfficeContext);

  readonly members = signal<MemberView[]>([]);
  readonly invites = signal<Invite[]>([]);
  readonly loading = signal(true);
  readonly busy = signal<string | null>(null); // 操作中の uid・招待のコード
  readonly errorKey = signal<string | null>(null);

  // 招待のフォーム
  readonly email = signal('');
  readonly role = signal<OfficeRole>('general');
  readonly emailValid = computed(() => EMAIL_RE.test(this.email().trim()));
  readonly created = signal<Invite | null>(null);
  readonly copiedCode = signal<string | null>(null);

  readonly officeId = computed(() => this.context.current()?.id ?? '');

  ngOnInit(): void {
    this.load();
  }

  private async load(): Promise<void> {
    const officeId = this.officeId();
    if (!officeId) return;
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const [members, invites] = await Promise.all([
        this.api.list(officeId),
        this.context.isAdmin() ? this.api.pendingInvites(officeId) : Promise.resolve([]),
      ]);
      this.members.set(members);
      this.invites.set(invites);
    } catch (err) {
      console.error(err);
      this.errorKey.set('members.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  // ===== メンバーへの操作 =====

  async act(m: MemberView, action: MemberAction): Promise<void> {
    const officeId = this.officeId();
    if (!officeId || this.busy()) return;
    const key = `members.confirm.${action}${m.me ? 'Self' : ''}`;
    if (!window.confirm(this.transloco.translate(key, { name: m.name || m.email }))) return;
    this.busy.set(m.uid);
    this.errorKey.set(null);
    try {
      await this.api.update(officeId, m.uid, action);
      // 自分が抜けたら、ほかの事業所（なければログインの画面）へ
      if (m.me && action === 'remove') {
        await this.router.navigateByUrl('/');
        return;
      }
      // 名簿が変わったので、開いている事業所を読み直す（自分の権限が変わったときに画面を合わせるため）
      const office = await this.offices.get(officeId);
      if (office) this.context.setCurrent(office);
      this.toast.show('members.done.' + action);
      await this.load();
    } catch (err) {
      console.error(err);
      this.errorKey.set(`members.error.${reasonOf(err)}`);
    } finally {
      this.busy.set(null);
    }
  }

  // ===== 招待 =====

  async invite(): Promise<void> {
    const officeId = this.officeId();
    if (!officeId || !this.emailValid() || this.busy()) return;
    this.busy.set('invite');
    this.errorKey.set(null);
    try {
      const inv = await this.api.createInvite(officeId, this.email(), this.role());
      this.created.set(inv);
      this.invites.update((l) => [inv, ...l]);
      this.email.set('');
    } catch (err) {
      console.error(err);
      this.errorKey.set('members.error.invite');
    } finally {
      this.busy.set(null);
    }
  }

  async revoke(i: Invite): Promise<void> {
    const officeId = this.officeId();
    if (!officeId || this.busy()) return;
    this.busy.set(i.code);
    try {
      await this.api.revoke(officeId, i.code);
      this.invites.update((l) => l.filter((x) => x.code !== i.code));
      if (this.created()?.code === i.code) this.created.set(null);
    } catch (err) {
      console.error(err);
      this.errorKey.set('members.error.revoke');
    } finally {
      this.busy.set(null);
    }
  }

  link(i: Invite): string {
    return joinUrl(location.origin, this.officeId(), i.code);
  }

  async copy(i: Invite): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.link(i));
      this.copiedCode.set(i.code);
      setTimeout(() => this.copiedCode.set(null), 2000);
    } catch {
      // クリップボードが使えないときは、表示されたリンクを手で選んでもらう
    }
  }

  expires(i: Invite): string {
    return i.expiresAt.toDate().toLocaleDateString();
  }

  /** 自分（ログイン中）の表示名：関数の一覧に名前がないとき（古いアカウント）の代わり */
  nameOf(m: MemberView): string {
    return m.name || (m.me ? (this.auth.profile()?.displayName ?? '') : '') || m.email;
  }
}
