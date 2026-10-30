import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService, toAuthErrorKey } from '../../../../core/auth/auth.service';
import { LangSwitch } from '../../../../shared/components/lang-switch/lang-switch';

/** 8文字以上・英字と数字を両方含む（kensyu10168のパスワードポリシーと同じ） */
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

/** パスワードと確認用が一致しているか（フォーム全体に付けるチェック） */
function passwordMatch(group: AbstractControl): ValidationErrors | null {
  const pw = group.get('password')?.value;
  const confirm = group.get('passwordConfirm')?.value;
  return pw && confirm && pw !== confirm ? { passwordMismatch: true } : null;
}

type FieldName = 'displayName' | 'email' | 'password' | 'passwordConfirm';

@Component({
  selector: 'app-signup',
  imports: [ReactiveFormsModule, RouterLink, TranslocoPipe, LangSwitch],
  templateUrl: './signup.html',
  styleUrl: '../auth-layout.css',
})
export class Signup {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

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

  showError(name: FieldName): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  /** 確認用の欄：未入力 または 不一致 のとき赤くする */
  showConfirmError(): boolean {
    const c = this.form.controls.passwordConfirm;
    return c.touched && (c.invalid || this.form.hasError('passwordMismatch'));
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorKey.set(null);

    const { displayName, email, password } = this.form.getRawValue();
    try {
      await this.auth.signUp(email, password, displayName.trim());
      await this.router.navigateByUrl('/home');
    } catch (err) {
      this.errorKey.set(toAuthErrorKey(err));
    } finally {
      this.submitting.set(false);
    }
  }
}