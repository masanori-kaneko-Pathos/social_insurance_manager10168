import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService, toAuthErrorKey } from '../../../../core/auth/auth.service';
import { LanguageService } from '../../../../core/i18n/language.service';
import { LangSwitch } from '../../../../shared/components/lang-switch/lang-switch';

import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
@Component({
  selector: 'app-forgot-password',
  imports: [HalfWidthDigits, ReactiveFormsModule, RouterLink, TranslocoPipe, LangSwitch],
  templateUrl: './forgot-password.html',
  styleUrl: '../../auth-layout.css',
})
export class ForgotPassword {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly language = inject(LanguageService);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  readonly submitting = signal(false);
  readonly sent = signal(false);
  readonly errorKey = signal<string | null>(null);

  showError(): boolean {
    const c = this.form.controls.email;
    return c.invalid && c.touched;
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorKey.set(null);

    try {
      await this.auth.sendPasswordReset(this.form.getRawValue().email, this.language.lang());
      this.sent.set(true);
    } catch (err) {
      this.errorKey.set(toAuthErrorKey(err));
    } finally {
      this.submitting.set(false);
    }
  }
}