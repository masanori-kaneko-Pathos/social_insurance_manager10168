import { Component, inject, input, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService, toAuthErrorKey } from '../../../../core/auth/auth.service';
import { PasswordField } from '../../../../shared/components/password-field/password-field';
import { PasswordInputDirective } from '../../../../shared/components/password-field/password-input.directive';

/** 新規登録の画面と同じ決まり（8文字以上・英字と数字） */
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

function passwordMatch(group: AbstractControl): ValidationErrors | null {
  const pw = group.get('next')?.value;
  const confirm = group.get('confirm')?.value;
  return pw && confirm && pw !== confirm ? { passwordMismatch: true } : null;
}

type Section = 'name' | 'password' | 'email';

/**
 * アカウントの設定（表示名・パスワード・ログイン用のメールアドレス）。労務担当とマイページで同じ部品
 * - パスワード・メールアドレスは、今のパスワードで本人を確かめ直してから変える
 * - メールアドレスは、新しいアドレスに届いた確認のリンクを押した時点で切り替わる（打ち間違いで締め出されないため）
 */
@Component({
  selector: 'app-account-settings',
  imports: [ReactiveFormsModule, TranslocoPipe, PasswordField, PasswordInputDirective],
  templateUrl: './account-settings.html',
  styleUrl: './account-settings.css',
})
export class AccountSettings {
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);
  /** 従業員のマイページのとき（会社の記録の連絡先メールとは別、と添える） */
  readonly employee = input(false);

  readonly busy = signal<Section | null>(null);
  readonly done = signal<Section | null>(null);
  readonly errors = signal<Partial<Record<Section, string>>>({});
  readonly sentTo = signal<string | null>(null);

  readonly nameForm = this.fb.nonNullable.group({
    displayName: [this.auth.profile()?.displayName ?? '', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(50)]],
  });
  readonly passwordForm = this.fb.nonNullable.group(
    {
      current: ['', [Validators.required]],
      next: ['', [Validators.required, Validators.pattern(PASSWORD_RULE)]],
      confirm: ['', [Validators.required]],
    },
    { validators: passwordMatch },
  );
  readonly emailForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    current: ['', [Validators.required]],
  });

  invalid(form: 'name' | 'password' | 'email', name: string): boolean {
    const group: { get(path: string): AbstractControl | null } =
      form === 'name' ? this.nameForm : form === 'password' ? this.passwordForm : this.emailForm;
    const c = group.get(name);
    return !!c && c.invalid && c.touched;
  }

  mismatch(): boolean {
    const c = this.passwordForm.controls.confirm;
    return c.touched && (c.invalid || this.passwordForm.hasError('passwordMismatch'));
  }

  async saveName(): Promise<void> {
    if (this.nameForm.invalid) return this.nameForm.markAllAsTouched();
    await this.run('name', () => this.auth.changeDisplayName(this.nameForm.getRawValue().displayName.trim()));
  }

  async savePassword(): Promise<void> {
    if (this.passwordForm.invalid) return this.passwordForm.markAllAsTouched();
    const { current, next } = this.passwordForm.getRawValue();
    await this.run('password', async () => {
      await this.auth.changePassword(current, next);
      this.passwordForm.reset();
    });
  }

  async sendEmail(): Promise<void> {
    if (this.emailForm.invalid) return this.emailForm.markAllAsTouched();
    const { email, current } = this.emailForm.getRawValue();
    const next = email.trim();
    if (next.toLowerCase() === (this.auth.user()?.email ?? '').toLowerCase()) {
      this.errors.update((e) => ({ ...e, email: 'accountPage.sameEmail' }));
      return;
    }
    await this.run('email', async () => {
      await this.auth.changeEmail(current, next);
      this.sentTo.set(next);
      this.emailForm.reset();
    });
  }

  private async run(section: Section, fn: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(section);
    this.done.set(null);
    this.errors.update((e) => ({ ...e, [section]: undefined }));
    try {
      await fn();
      this.done.set(section);
    } catch (err) {
      this.errors.update((e) => ({ ...e, [section]: toAuthErrorKey(err) }));
    } finally {
      this.busy.set(null);
    }
  }
}
