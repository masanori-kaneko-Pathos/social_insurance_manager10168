import { Component, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { InboxNotification } from '../../../../core/models/office-records';
import { Bell } from '../../../../shared/components/bell/bell';
import { AccountMenu } from '../../../office/components/account-menu/account-menu';
import { MeInboxService } from '../../me-inbox.service';

/** マイページの上の帯（アプリ名・事業所名・ベル・設定のメニュー） */
@Component({
  selector: 'app-me-header',
  imports: [AccountMenu, Bell, RouterLink, TranslocoPipe],
  template: `
    <header class="app-header">
      <div class="header-left">
        <a class="app-name" routerLink="/me">{{ 'me.title' | transloco }}</a>
        @if (officeName()) { <span class="office">{{ officeName() }}</span> }
      </div>
      <div class="header-right">
        <!-- ベル：受信箱の未読。押すと既読にして、依頼があればそこへ -->
        <app-bell [count]="inbox.unread()">
          @for (n of inbox.latest(); track n.id) {
            <button type="button" class="bell-item" [class.unread]="!n.readAt" (click)="open(n)">
              {{ n.title }}
              <span class="bell-sub">{{ date(n) }}</span>
            </button>
          } @empty {
            <p class="bell-sub">{{ 'bell.empty' | transloco }}</p>
          }
          <a class="bell-item" routerLink="/me">{{ 'bell.toInbox' | transloco }} →</a>
        </app-bell>
        <app-account-menu />
      </div>
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
    .header-right {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
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
  private readonly router = inject(Router);
  readonly inbox = inject(MeInboxService);
  readonly officeName = input<string | null>(null);

  async open(n: InboxNotification): Promise<void> {
    this.inbox.markRead(n).catch((err) => console.error(err));
    if (n.link) await this.router.navigate(['/me', 'requests', n.link]);
  }

  date(n: InboxNotification): string {
    return n.createdAt ? n.createdAt.toDate().toLocaleDateString() : '';
  }
}
