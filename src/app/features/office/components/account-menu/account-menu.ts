import { Component, computed, ElementRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { AuthService } from '../../../../core/auth/auth.service';
import { Lang, LanguageService } from '../../../../core/i18n/language.service';
import { THEME_PREFS, ThemeService } from '../../../../core/theme/theme.service';
import { OfficeContext } from '../../office-context.service';

/**
 * ヘッダーの「設定」：表示名・言語の切り替え・ログアウトをまとめたプルダウン
 * 開くとき・閉じるときに動きをつける（animate.enter / animate.leave。Angular 20.2〜）
 */
@Component({
  selector: 'app-account-menu',
  imports: [TranslocoPipe],
  templateUrl: './account-menu.html',
  styleUrl: './account-menu.css',
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'close()',
  },
})
export class AccountMenu {
  private readonly auth = inject(AuthService);
  private readonly context = inject(OfficeContext);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly language = inject(LanguageService);
  readonly theme = inject(ThemeService);
  readonly themePrefs = THEME_PREFS;

  readonly profile = this.auth.profile;
  readonly open = signal(false);
  readonly loggingOut = signal(false);
  /** アカウントの設定を開けるか（事業所がまだない管理者は、開く先がないので出さない） */
  readonly canOpenSettings = computed(() => this.profile()?.role === 'employee' || !!this.context.current());

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }

  onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  setLang(lang: Lang): void {
    this.language.set(lang);
  }

  /** アカウントの設定：従業員はマイページの中、労務担当は今の事業所の中 */
  async openSettings(): Promise<void> {
    this.close();
    const officeId = this.context.current()?.id;
    const url = this.profile()?.role === 'employee' || !officeId ? '/me/account' : `/o/${officeId}/account`;
    await this.router.navigateByUrl(url);
  }

  async logout(): Promise<void> {
    // 押し間違いで締め出されないように、ひと声かける（ブラウザの確認窓）
    if (!window.confirm(this.transloco.translate('account.logoutConfirm'))) return;
    this.loggingOut.set(true);
    try {
      this.close();
      this.context.clear(); // 次の人に前の事業所が残らないように
      await this.auth.logout();
      await this.router.navigateByUrl('/login');
    } finally {
      this.loggingOut.set(false);
    }
  }
}
