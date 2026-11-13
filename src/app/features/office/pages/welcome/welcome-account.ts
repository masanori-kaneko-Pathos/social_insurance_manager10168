import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AccountSettings } from '../../../account/components/account-settings/account-settings';
import { AccountMenu } from '../../components/account-menu/account-menu';

/**
 * 事業所がまだない管理者のアカウントの設定（/start/account。11/13）
 * 事業所の画面の枠（サイドバー）がないので、「はじめに」と同じ上の帯で包む
 */
@Component({
  selector: 'app-welcome-account',
  imports: [AccountMenu, AccountSettings, RouterLink, TranslocoPipe],
  template: `
    <header class="app-header">
      <span class="app-name">{{ 'common.appName' | transloco }}</span>
      <app-account-menu />
    </header>
    <main class="page">
      <a class="back" routerLink="/start">← {{ 'welcome.back' | transloco }}</a>
      <h1>{{ 'accountPage.title' | transloco }}</h1>
      <app-account-settings />
    </main>
  `,
  styleUrl: './welcome.css',
  styles: `
    .back {
      display: inline-block;
      margin-bottom: var(--space-sm);
      font-size: var(--font-sm);
      color: var(--color-text-sub);
    }
    h1 {
      margin: 0 0 var(--space-md);
    }
  `,
})
export class WelcomeAccount {}
