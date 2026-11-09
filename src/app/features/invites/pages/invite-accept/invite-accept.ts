import { Component, computed, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService, toAuthErrorKey } from '../../../../core/auth/auth.service';
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
 * 招待のリンクから開く画面：マイページのアカウントを作る
 * - ログインしていなければ、登録のフォーム
 * - その招待で作ったアカウントでログイン中なら、マイページへ
 * - ほかのアカウントでログイン中なら、ログアウトしてから開き直してもらう
 */
@Component({
  selector: 'app-invite-accept',
  imports: [ReactiveFormsModule, RouterLink, TranslocoPipe, LangSwitch, PasswordField, PasswordInputDirective],
  templateUrl: './invite-accept.html',
  styleUrl: '../../../auth/auth-layout.css',
})
export class InviteAccept {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly invites = inject(InviteService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly officeId = this.route.snapshot.paramMap.get('officeId') ?? '';
  readonly code = this.route.snapshot.paramMap.get('code') ?? '';
  readonly badLink = !this.officeId || !isInviteCode(this.code);

  readonly ready = this.auth.ready;
  /** ログイン中の状態：なし／この招待の本人／ほかのアカウント */
  readonly signedInAs = computed<'none' | 'self' | 'other'>(() => {
    // 登録の途中（Auth のアカウントはできたが、まだ users がない）はフォームのまま
    if (!this.auth.user() || this.submitting()) return 'none';
    const ref = this.auth.profile()?.employeeRef;
    return ref?.officeId === this.officeId && ref.inviteCode === this.code ? 'self' : 'other';
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

  readonly submitting = signal(false);
  readonly errorKey = signal<string | null>(null);

  constructor() {
    // ログイン中なら profile を読んでから判定する（本人ならそのままマイページへ）
    this.auth.whenReady.then(async () => {
      if (!this.auth.user()) return;
      await this.auth.ensureProfile().catch(() => false);
      if (this.signedInAs() === 'self') await this.router.navigateByUrl('/me');
    });
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
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.badLink) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorKey.set(null);
    const { displayName, email, password } = this.form.getRawValue();
    const name = displayName.trim();
    try {
      await this.auth.signUpWith(email, password, name, (user, lang) =>
        this.invites.accept(this.officeId, this.code, user, name, lang),
      );
      await this.router.navigateByUrl('/me');
    } catch (err) {
      this.errorKey.set(errorKeyOf(err));
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
