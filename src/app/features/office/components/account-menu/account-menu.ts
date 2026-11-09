import { Component, ElementRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../../../core/auth/auth.service';
import { LanguageService } from '../../../../core/i18n/language.service';
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly language = inject(LanguageService);

  readonly profile = this.auth.profile;
  readonly open = signal(false);
  readonly loggingOut = signal(false);

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }

  onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  setLang(lang: 'ja' | 'en'): void {
    this.language.set(lang);
  }

  async logout(): Promise<void> {
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
