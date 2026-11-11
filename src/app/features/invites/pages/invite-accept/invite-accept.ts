import { Component, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService, toAuthErrorKey } from '../../../../core/auth/auth.service';
import { LanguageService, Lang } from '../../../../core/i18n/language.service';
import { Invite } from '../../../../core/models/office-records';
import { LangSwitch } from '../../../../shared/components/lang-switch/lang-switch';
import { PasswordField } from '../../../../shared/components/password-field/password-field';
import { PasswordInputDirective } from '../../../../shared/components/password-field/password-input.directive';
import { InviteRejected, InviteService } from '../../invite.service';
import { isInviteCode } from '../../logic/invite';

/** 新規登録の画面と同じ決まり（8文字以上・英字と数字） */
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

function passwordMatch(group: AbstractControl): ValidationErrors | null {
  const pw = group.get('password')?.value;
  const confirm = group.get('passwordConfirm')?.value;
  return pw && confirm && pw !== confirm ? { passwordMismatch: true } : null;
}

type FieldName = 'displayName' | 'email' | 'password' | 'passwordConfirm';

/**
 * 招待のリンクから開く画面：従業員のマイページのアカウントを作る（/invite/:officeId/:code）
 * - ログインしていない：登録のフォーム
 * - 登録した（users はまだ）：会社がアドレスを決めた招待なら、確認のメールのリンクを押してから「登録を終える」
 *   （アドレスを決めていない招待は、そのまま登録を終える）
 * - その招待で作ったアカウントでログイン中：マイページへ
 * - ほかのアカウントでログイン中：ログアウトしてから開き直してもらう
 * 確認待ちの人を追い出さないよう、ログインのガードの外に置いている（/join と同じ考え方）
 */
@Component({
  selector: 'app-invite-accept',
  imports: [ReactiveFormsModule, RouterLink, TranslocoPipe, LangSwitch, PasswordField, PasswordInputDirective],
  templateUrl: './invite-accept.html',
  styleUrls: ['../../../auth/auth-layout.css', '../join/join.css'],
})
export class InviteAccept {
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);
  private readonly language = inject(LanguageService);
  private readonly invites = inject(InviteService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly officeId = this.route.snapshot.paramMap.get('officeId') ?? '';
  readonly code = this.route.snapshot.paramMap.get('code') ?? '';
  readonly badLink = !this.officeId || !isInviteCode(this.code);

  readonly checking = signal(true);
  readonly invite = signal<Invite | null>(null);
  readonly hasProfile = signal(false);
  readonly submitting = signal(false);
  readonly errorKey = signal<string | null>(null);

  /** 画面の状態 */
  readonly state = computed<'loading' | 'signedOut' | 'self' | 'other' | 'unverified' | 'ready'>(() => {
    if (!this.auth.ready() || this.checking()) return 'loading';
    const user = this.auth.user();
    if (!user) return 'signedOut';
    if (this.hasProfile()) {
      const ref = this.auth.profile()?.employeeRef;
      return ref?.officeId === this.officeId && ref.inviteCode === this.code ? 'self' : 'other';
    }
    // 登録の途中（Auth のアカウントはあるが users はまだ）
    return this.invite()?.email && !user.emailVerified ? 'unverified' : 'ready';
  });

  readonly form = this.fb.nonNullable.group(
    {
      displayName: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(50)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.pattern(PASSWORD_RULE)]],
      passwordConfirm: ['', [Validators.required]],
    },
    { validators: passwordMatch },
  );

  constructor() {
    this.auth.whenReady.then(async () => {
      if (this.auth.user()) await this.look();
      this.checking.set(false);
      if (this.state() === 'self') await this.router.navigateByUrl('/me');
    });
  }

  /** ログイン中：確認が済んだか・users があるか・招待の中身を見る（なくても追い出さない） */
  private async look(): Promise<void> {
    await this.auth.refreshVerified().catch(() => false);
    this.hasProfile.set(await this.auth.peekProfile().catch(() => false));
    if (!this.hasProfile() && !this.badLink) {
      this.invite.set(await this.invites.get(this.officeId, this.code).catch(() => null));
    }
  }

  showError(name: FieldName): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  showConfirmError(): boolean {
    const c = this.form.controls.passwordConfirm;
    return c.touched && (c.invalid || this.form.hasError('passwordMismatch'));
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    this.hasProfile.set(false);
    this.invite.set(null);
  }

  /** 登録：Auth のアカウントを作る → 招待を見る → アドレスを決めた招待なら確認のメール、そうでなければそのまま終える */
  async submit(): Promise<void> {
    if (this.form.invalid || this.badLink) {
      this.form.markAllAsTouched();
      return;
    }
    const { displayName, email, password } = this.form.getRawValue();
    await this.run(async () => {
      await this.auth.createAuthUser(email.trim(), password, displayName.trim());
      const inv = await this.invites.get(this.officeId, this.code);
      this.invite.set(inv);
      if (!inv) throw new InviteRejected('notFound');
      if (inv.email) await this.auth.sendVerification(location.href);
      else await this.finish();
    });
  }

  async resend(): Promise<void> {
    await this.run(() => this.auth.sendVerification(location.href));
  }

  /** 確認のメールのリンクを押した → 確かめて登録を終える */
  async checkAndFinish(): Promise<void> {
    await this.run(async () => {
      if (!(await this.auth.refreshVerified())) {
        this.errorKey.set('join.notYetVerified');
        return;
      }
      await this.finish();
    });
  }

  async finishNow(): Promise<void> {
    await this.run(() => this.finish());
  }

  /** users・招待の使用・従業員の userUid を1つの batch で書く（ルールが照らし合わせる） */
  private async finish(): Promise<void> {
    const user = this.auth.user();
    if (!user) return;
    const name = user.displayName || this.form.getRawValue().displayName.trim() || (user.email ?? '');
    await this.invites.accept(this.officeId, this.code, user, name, this.language.lang() as Lang);
    await this.auth.reloadProfile();
    await this.router.navigateByUrl('/me');
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.errorKey.set(null);
    try {
      await fn();
    } catch (err) {
      this.errorKey.set(errorKeyOf(err));
      // 招待そのものが使えない（アドレス違い・期限切れなど）なら、作った Auth のアカウントを消して作り直せるようにする
      if (err instanceof InviteRejected) await this.auth.discardPendingUser();
    } finally {
      this.submitting.set(false);
    }
  }
}

function errorKeyOf(err: unknown): string {
  if (err instanceof InviteRejected) return `invite.error.${err.reason}`;
  if ((err as { code?: string })?.code === 'permission-denied') return 'invite.error.denied';
  return toAuthErrorKey(err);
}
