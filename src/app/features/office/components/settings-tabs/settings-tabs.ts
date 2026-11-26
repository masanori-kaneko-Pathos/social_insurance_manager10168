import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { BackLink } from '../../../../shared/components/back-link/back-link';
import { OfficeContext } from '../../office-context.service';

/**
 * 事業所の設定の見出しとタブ（事業所・マスタ。11/26）
 * - 戻る・見出し・タブを、どのタブでも同じ位置に出す（目次より上。タブを切り替えても見出しが動かない）
 * - タブの切り替えは「前の画面」に積まない（ルートの data.tabRoot。戻るは設定を開く前の画面へ）
 */
@Component({
  selector: 'app-settings-tabs',
  imports: [BackLink, RouterLink, RouterLinkActive, TranslocoPipe],
  template: `
    <app-back-link [fallback]="['/o', context.current()?.id]" fallbackName="back.home" />
    <h1 id="sec-top">{{ 'office.form.titleEdit' | transloco }}</h1>
    <nav class="page-tabs" [attr.aria-label]="'settings.tabs' | transloco">
      <a
        [routerLink]="['/o', context.current()?.id, 'settings']"
        routerLinkActive="active"
        [routerLinkActiveOptions]="{ exact: true }"
        ariaCurrentWhenActive="page"
        >{{ 'settings.tab.office' | transloco }}</a
      >
      <a
        [routerLink]="['/o', context.current()?.id, 'settings', 'masters']"
        routerLinkActive="active"
        ariaCurrentWhenActive="page"
        >{{ 'settings.tab.masters' | transloco }}</a
      >
    </nav>
  `,
  styles: `
    :host {
      display: block;
    }
    /* 目次のある画面（office-form の .layout.with-toc）と左の端をそろえる */
    @media (min-width: 1001px) {
      :host {
        padding-left: var(--space-sm);
      }
    }
    h1 {
      scroll-margin-top: var(--space-lg);
    }
  `,
})
export class SettingsTabs {
  readonly context = inject(OfficeContext);
}
