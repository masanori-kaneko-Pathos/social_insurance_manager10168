import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Icon, IconName } from '../icon/icon';

/** 入り口の1枚（名前と、どんなときに使うかの1文） */
export interface EntryChoiceItem {
  icon: IconName;
  titleKey: string;
  noteKey: string;
  link: readonly unknown[];
  queryParams?: Record<string, string>;
}

/**
 * 登録の入り口を2枚のカードで並べる（1人ずつ登録／ファイルから取り込み。11/26）
 * 一覧の表の上にいつも同じ形で置く（件数でボタンの位置や形が変わらないように）
 */
@Component({
  selector: 'app-entry-choice',
  imports: [Icon, RouterLink, TranslocoPipe],
  template: `
    <nav class="entry" [attr.aria-label]="labelKey() | transloco">
      @for (it of items(); track it.titleKey) {
        <a class="tile" [routerLink]="it.link" [queryParams]="it.queryParams ?? null">
          <app-icon class="mark" [name]="it.icon" />
          <span class="text">
            <span class="name">{{ it.titleKey | transloco }} ›</span>
            <span class="note">{{ it.noteKey | transloco }}</span>
          </span>
        </a>
      }
    </nav>
  `,
  styles: `
    .entry {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
      gap: var(--space-sm);
      margin-bottom: var(--space-md);
    }
    .tile {
      display: flex;
      align-items: flex-start;
      gap: var(--space-sm);
      padding: var(--space-md) 20px;
      color: var(--color-text);
      text-decoration: none;
      background: var(--color-surface);
      border: 1px solid var(--color-card-border);
      border-radius: var(--radius-md);
      transition: background-color var(--dur-fast) var(--ease-out);
    }
    .tile:hover {
      text-decoration: none;
      background: var(--color-hover);
    }
    .tile:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 2px;
    }
    .mark {
      flex: none;
      margin-top: 3px;
      color: var(--color-tab-active);
    }
    .text {
      display: flex;
      flex-direction: column;
      gap: var(--space-xs);
    }
    .name {
      font-size: var(--font-md);
      font-weight: 600;
    }
    .note {
      font-size: var(--font-sm);
      color: var(--color-text-sub);
    }
  `,
})
export class EntryChoice {
  readonly items = input.required<readonly EntryChoiceItem[]>();
  readonly labelKey = input('entryChoice.label');
}
