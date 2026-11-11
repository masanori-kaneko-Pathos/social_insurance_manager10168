import { Component, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService, toAuthErrorKey } from '../../../../core/auth/auth.service';

/**
 * パスワードで本人を確かめ直す小さな欄（マイナンバーの全桁を見る・書き出す前）
 * 確かめられたら confirmed を出す。関数側は「5分以内にログインし直したか」で確かめる
 */
@Component({
  selector: 'app-password-gate',
  imports: [TranslocoPipe],
  template: `
    <form class="gate" (submit)="$event.preventDefault(); confirm()">
      <label class="field">
        <span>{{ 'myNumber.gate.label' | transloco }}</span>
        <input
          class="input"
          type="password"
          autocomplete="current-password"
          [value]="password()"
          (input)="password.set($any($event.target).value)"
        />
      </label>
      <button type="submit" class="btn btn-solid" [disabled]="busy() || !password()">
        {{ action() | transloco }}
      </button>
      <button type="button" class="btn" (click)="cancelled.emit()">{{ 'common.cancel' | transloco }}</button>
      @if (errorKey(); as e) {
        <p class="field-error" role="alert">{{ e | transloco }}</p>
      }
      <p class="hint">{{ 'myNumber.gate.hint' | transloco }}</p>
    </form>
  `,
  styles: `
    .gate { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-sm); margin: var(--space-sm) 0; }
    .gate .field { display: flex; flex-direction: column; gap: 4px; }
    .gate .hint, .gate .field-error { flex-basis: 100%; margin: 0; }
  `,
})
export class PasswordGate {
  private readonly auth = inject(AuthService);
  /** ボタンの文字（翻訳キー） */
  readonly action = input('myNumber.gate.confirm');
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  readonly password = signal('');
  readonly busy = signal(false);
  readonly errorKey = signal<string | null>(null);

  async confirm(): Promise<void> {
    if (this.busy() || !this.password()) return;
    this.busy.set(true);
    this.errorKey.set(null);
    try {
      await this.auth.confirmPassword(this.password());
      this.password.set('');
      this.confirmed.emit();
    } catch (err) {
      this.errorKey.set(toAuthErrorKey(err));
    } finally {
      this.busy.set(false);
    }
  }
}
