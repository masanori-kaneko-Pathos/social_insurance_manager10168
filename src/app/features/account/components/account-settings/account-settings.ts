import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from '../../../../core/i18n/language.service';
import { OfficeContext } from '../../../office/office-context.service';
import { reasonOf } from '../../../members/member.service';
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

type Section = 'name' | 'password' | 'email' | 'delete';

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
  /** パスワード・メールアドレスの変更は、ボタンを押したときだけ開く（ふだんは閉じておく） */
  readonly opened = signal<'password' | 'email' | 'delete' | null>(null);
  private readonly router = inject(Router);
  private readonly language = inject(LanguageService);
  private readonly context = inject(OfficeContext);

  /** 代表になっている事業所（1つでもあれば消せない。名簿の最初の人が代表の古い事業所も同じ） */
  readonly ownedOffices = computed(() => {
    const uid = this.auth.user()?.uid;
    return this.context
      .mine()
      .filter((o) => (o.ownerUid && o.memberUids.includes(o.ownerUid) ? o.ownerUid : o.memberUids[0]) === uid);
  });

  readonly ownedOfficeNames = computed(() => this.ownedOffices().map((o) => o.name).join('、'));

  /** 押し間違いの防止に打ってもらう文字（「削除」／DELETE） */
  readonly deleteWord = computed(() => (this.language.lang() === 'en' ? 'DELETE' : '削除'));

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
  readonly deleteForm = this.fb.nonNullable.group({
    current: ['', [Validators.required]],
    word: ['', [Validators.required]],
  });

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

  /** 開く（もう一方は閉じる。前の結果・エラーは消す） */
  openSection(section: 'password' | 'email' | 'delete'): void {
    this.opened.set(section);
    this.done.set(null);
    this.errors.update((e) => ({ ...e, [section]: undefined }));
  }

  /** キャンセル：入れかけた内容を消して閉じる */
  cancel(section: 'password' | 'email' | 'delete'): void {
    (section === 'password' ? this.passwordForm : section === 'email' ? this.emailForm : this.deleteForm).reset();
    this.errors.update((e) => ({ ...e, [section]: undefined }));
    this.opened.set(null);
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
      this.opened.set(null);
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
      this.opened.set(null);
    });
  }

  /** 「削除」の文字が合っているか（前後の空白は無視） */
  wordOk(): boolean {
    return this.deleteForm.controls.word.value.trim() === this.deleteWord();
  }

  /** アカウントを消す：本人の確認 → 関数 → ログアウト → ログイン画面（「削除しました」） */
  async deleteAccount(): Promise<void> {
    if (this.deleteForm.invalid || !this.wordOk() || this.ownedOffices().length > 0 || this.busy()) return;
    this.busy.set('delete');
    this.errors.update((e) => ({ ...e, delete: undefined }));
    try {
      await this.auth.deleteAccount(this.deleteForm.getRawValue().current);
      await this.router.navigate(['/login'], { queryParams: { reason: 'deleted' } });
    } catch (err) {
      const reason = reasonOf(err);
      this.errors.update((e) => ({
        ...e,
        delete: reason === 'owner' || reason === 'employee' ? `accountPage.delete.error.${reason}` : toAuthErrorKey(err),
      }));
    } finally {
      this.busy.set(null);
    }
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
