import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { MeHeader } from '../../../me/components/me-header/me-header';
import { MeContext } from '../../../me/me-context.service';
import { AccountSettings } from '../../components/account-settings/account-settings';

/** 従業員（マイページ）のアカウントの設定（/me/account） */
@Component({
  selector: 'app-my-account',
  imports: [AccountSettings, MeHeader, RouterLink, TranslocoPipe],
  template: `
    <app-me-header [officeName]="me.office()?.name ?? null" />
    <main class="me-main">
      <a class="back" routerLink="/me">← {{ 'me.title' | transloco }}</a>
      <h1>{{ 'accountPage.title' | transloco }}</h1>
      <app-account-settings [employee]="true" />
    </main>
  `,
  styleUrl: '../../../me/pages/me.css',
})
export class MyAccountPage {
  readonly me = inject(MeContext);

  constructor() {
    // 上の帯の事業所名のため（ほかのマイページの画面と同じ。読み込み済みなら何もしない）
    this.me.load().catch((err) => console.error(err));
  }
}
