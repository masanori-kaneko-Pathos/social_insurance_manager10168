import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { OfficeContext } from '../../office-context.service';

/** 設定のタブ（事業所・マスタ。11/26） */
@Component({
  selector: 'app-settings-tabs',
  imports: [RouterLink, RouterLinkActive, TranslocoPipe],
  template: `
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
})
export class SettingsTabs {
  readonly context = inject(OfficeContext);
}
