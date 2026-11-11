import { Component, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService, toAuthErrorKey } from '../../../../core/auth/auth.service';
import { LanguageService } from '../../../../core/i18n/language.service';
import { LangSwitch } from '../../../../shared/components/lang-switch/lang-switch';
import { PasswordField } from '../../../../shared/components/password-field/password-field';
import { PasswordInputDirective } from '../../../../shared/components/password-field/password-input.directive';
import { MemberService, reasonOf } from '../../../members/member.service';
import { OfficeContext } from '../../../office/office-context.service';
import { isInviteCode } from '../../logic/invite';

/** 新規登録の画面と同じ決まり（8文字以上・英字と数字） */
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

function passwordMatch(group: AbstractControl): ValidationErrors | null {
  const pw = group.get('password')?.value;
  const confirm = group.get('passwordConfirm')?.value;
  return pw && confirm && pw !== confirm ? { passwordMismatch: true } : null;
}

/** 招待の理由のうち、invite.error にあるもの（それ以外は denied） */
const KNOWN = new Set(['notFound', 'used', 'expired', 'email', 'kind', 'unverified', 'employeeAccount']);

/**
 * 事業所のメンバー（管理者・一般）への招待のリンク（/join/:officeId/:code）
 * - ログインしていない：アカウントを作る（確認のメールが届く）／もうアカウントがある人はログイン
 * - ログイン中・メールの確認がまだ：確認のメールのリンクを押してから「参加する」
 * - ログイン中・確認済み：「参加する」→ 関数が招待を確かめて名簿に足す → その事業所へ
 * users がまだない人（確認待ち）を追い出さないよう、ログインのガードの外に置き、ログインもこの画面の中で行う
 */
@Component({
  selector: 'app-join',
  imports: [ReactiveFormsModule, TranslocoPipe, LangSwitch, PasswordField, PasswordInputDirective],
  templateUrl: './join.html',
  styleUrls: ['../../../auth/auth-layout.css', './join.css'],
})
export class JoinPage {
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);
  private readonly language = inject(LanguageService);
  private readonly members = inject(MemberService);
  private readonly context = inject(OfficeContext);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly officeId = this.route.snapshot.paramMap.get('officeId') ?? '';
  readonly code = this.route.snapshot.paramMap.get('code') ?? '';
  readonly badLink = !this.officeId || !isInviteCode(this.code);

  readonly checking = signal(true); // ログイン中なら、確認済みか・users を見終わるまで
  readonly mode = signal<'signup' | 'login'>('signup');
  readonly busy = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly sentTo = signal<string | null>(null); // 確認のメールを送ったアドレス

  readonly state = computed<'loading' | 'signedOut' | 'employee' | 'unverified' | 'ready'>(() => {
    if (!this.auth.ready() || this.checking()) return 'loading';
    const user = this.auth.user();
    if (!user) return 'signedOut';
    if (this.auth.profile()?.role === 'employee') return 'employee';
    return user.emailVerified ? 'ready' : 'unverified';
  });

  readonly signupForm = this.fb.nonNullable.group(
    {
      displayName: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(50)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.pattern(PASSWORD_RULE)]],
      passwordConfirm: ['', [Validators.required]],
    },
    { validators: passwordMatch },
  );
  readonly loginForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  constructor() {
    // ログイン中なら：確認のメールのリンクを押して戻ってきたかもしれないので、Firebase に聞き直す
    this.auth.whenReady.then(async () => {
      if (this.auth.user()) {
        await this.auth.refreshVerified().catch(() => false);
        await this.auth.peekProfile().catch(() => false);
      }
      this.checking.set(false);
    });
  }

  private get returnUrl(): string {
    return location.href;
  }

  // ===== ログインしていない =====

  showError(form: 'signup' | 'login', name: string): boolean {
    const group: { get(path: string): AbstractControl | null } = form === 'signup' ? this.signupForm : this.loginForm;
    const c = group.get(name);
    return !!c && c.invalid && c.touched;
  }

  showConfirmError(): boolean {
    const c = this.signupForm.controls.passwordConfirm;
    return c.touched && (c.invalid || this.signupForm.hasError('passwordMismatch'));
  }

  async signup(): Promise<void> {
    if (this.signupForm.invalid) {
      this.signupForm.markAllAsTouched();
      return;
    }
    const { displayName, email, password } = this.signupForm.getRawValue();
    await this.run(async () => {
      await this.auth.createAuthOnly(email.trim(), password, displayName.trim(), this.returnUrl);
      this.sentTo.set(email.trim());
    });
  }

  async login(): Promise<void> {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    const { email, password } = this.loginForm.getRawValue();
    await this.run(async () => {
      await this.auth.signInOnly(email.trim(), password);
      await this.auth.refreshVerified();
      await this.auth.peekProfile();
    });
  }

  // ===== ログイン中 =====

  async resend(): Promise<void> {
    await this.run(async () => {
      await this.auth.sendVerification(this.returnUrl);
      this.sentTo.set(this.auth.user()?.email ?? null);
    });
  }

  /** 確認のメールのリンクを押した → 確かめて参加 */
  async checkAndJoin(): Promise<void> {
    await this.run(async () => {
      if (!(await this.auth.refreshVerified())) {
        this.errorKey.set('join.notYetVerified');
        return;
      }
      await this.join();
    });
  }

  async joinNow(): Promise<void> {
    await this.run(() => this.join());
  }

  private async join(): Promise<void> {
    try {
      await this.members.accept(this.officeId, this.code, this.language.lang());
    } catch (err) {
      const reason = reasonOf(err);
      // もうメンバーなら、そのまま入る（2回押した・別の画面で参加した）
      if (reason !== 'alreadyMember') throw err;
    }
    await this.auth.reloadProfile();
    const uid = this.auth.user()?.uid;
    if (uid) await this.context.refresh(uid);
    await this.router.navigateByUrl(`/o/${this.officeId}`);
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    this.sentTo.set(null);
    this.errorKey.set(null);
  }

  /** 押している間は二重に押せないようにし、失敗の理由を翻訳キーにする */
  private async run(fn: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(null);
    try {
      await fn();
    } catch (err) {
      const reason = reasonOf(err);
      if (reason !== 'unknown') this.errorKey.set(KNOWN.has(reason) ? `invite.error.${reason}` : 'invite.error.denied');
      else this.errorKey.set(toAuthErrorKey(err));
    } finally {
      this.busy.set(false);
    }
  }
}
