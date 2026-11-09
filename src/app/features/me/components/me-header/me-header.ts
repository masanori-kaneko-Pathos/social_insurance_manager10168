import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AccountMenu } from '../../../office/components/account-menu/account-menu';

/** マイページの上の帯（アプリ名・事業所名・設定のメニュー） */
@Component({
  selector: 'app-me-header',
  imports: [AccountMenu, RouterLink, TranslocoPipe],
  template: `
    <header class="app-header">
      <div class="header-left">
        <a class="app-name" routerLink="/me">{{ 'me.title' | transloco }}</a>
        @if (officeName()) { <span class="office">{{ officeName() }}</span> }
      </div>
      <div class="header-right"><app-account-menu /></div>
    </header>
  `,
  styles: `
    .app-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-md);
      padding: var(--space-sm) var(--space-lg);
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: var(--space-md);
      min-width: 0;
    }
    .app-name {
      font-weight: 600;
      color: var(--color-text);
      text-decoration: none;
    }
    .office {
      overflow: hidden;
      font-size: var(--font-sm);
      color: var(--color-text-sub);
      white-space: nowrap;
      text-overflow: ellipsis;
    }
  `,
})
export class MeHeader {
  readonly officeName = input<string | null>(null);
}
