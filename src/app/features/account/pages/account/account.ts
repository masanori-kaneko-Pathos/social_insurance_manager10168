import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AccountSettings } from '../../components/account-settings/account-settings';

/** 労務担当（管理者・一般）のアカウントの設定（/o/:officeId/account） */
@Component({
  selector: 'app-account',
  imports: [AccountSettings, TranslocoPipe],
  template: `
    <h1 class="title">{{ 'accountPage.title' | transloco }}</h1>
    <app-account-settings />
  `,
  styles: `
    .title {
      margin: 0 0 var(--space-md);
      font-size: var(--font-xl);
    }
  `,
})
export class AccountPage {}
