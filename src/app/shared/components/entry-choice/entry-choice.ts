import { Component, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Icon, IconName } from '../icon/icon';

/** 入り口の1枚（名前と、どんなときに使うかの1文） */
export interface EntryChoiceItem {
  icon: IconName;
  titleKey: string;
  noteKey: string;
  /** 押したら開く画面（なければ chosen に key を知らせる：ファイルを選ぶ・最初の未入力の人を開く など。11/27） */
  link?: readonly unknown[];
  queryParams?: Record<string, string>;
  /** link がないときに知らせる名前 */
  key?: string;
  /** 押せないとき（理由は note に書く） */
  disabled?: boolean;
  /** カードの中のメーター（給与の「入力済み 50 / 60人」。11/27） */
  meter?: { textKey: string; params: Record<string, unknown>; pct: number };
}

/**
 * 登録の入り口を2枚のカードで並べる（1人ずつ登録／ファイルから取り込み。11/26）
 * 一覧の表の上にいつも同じ形で置く（件数でボタンの位置や形が変わらないように）
 */
@Component({
  selector: 'app-entry-choice',
  imports: [Icon, NgTemplateOutlet, RouterLink, TranslocoPipe],
  template: `
    <nav class="entry" [attr.aria-label]="labelKey() | transloco">
      @for (it of items(); track it.titleKey) {
        @if (it.link) {
          <a class="tile" [routerLink]="it.link" [queryParams]="it.queryParams ?? null">
            <ng-container *ngTemplateOutlet="body; context: { $implicit: it }" />
          </a>
        } @else {
          <button type="button" class="tile" [disabled]="it.disabled" (click)="chosen.emit(it.key ?? '')">
            <ng-container *ngTemplateOutlet="body; context: { $implicit: it }" />
          </button>
        }
      }
    </nav>
    <ng-template #body let-it>
      <app-icon class="mark" [name]="it.icon" />
      <span class="text">
        <span class="name">{{ it.titleKey | transloco }} ›</span>
        <span class="note">{{ it.noteKey | transloco }}</span>
        @if (it.meter; as m) {
          <span class="meter">
            <span class="meter-text">{{ m.textKey | transloco: m.params }}</span>
            <span class="meter-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="m.pct"><span [style.width.%]="m.pct"></span></span>
          </span>
        }
      </span>
    </ng-template>
  `,
  styles: `
    .entry {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
      gap: var(--space-sm);
      margin-bottom: var(--space-md);
    }
    /* カードが1枚だけ（依頼を作成）のときは、2枚並ぶ画面の1枚と同じ幅（横いっぱいの帯にしない。11/27） */
    .entry:has(> :only-child) {
      grid-template-columns: minmax(18rem, calc((100% - var(--space-sm)) / 2));
    }
    .tile {
      display: flex;
      width: 100%;
      font: inherit;
      text-align: left;
      cursor: pointer;
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
    .tile:disabled {
      cursor: default;
      opacity: 0.6;
    }
    .tile:disabled:hover {
      background: var(--color-surface);
    }
    /* カードの中のメーター（11/27） */
    .meter {
      display: flex;
      align-items: center;
      gap: var(--space-sm);
      margin-top: var(--space-xs);
      font-size: var(--font-sm);
      font-variant-numeric: tabular-nums;
    }
    .meter-bar {
      width: 10rem;
      height: 6px;
      border-radius: 999px;
      background: var(--color-border);
      overflow: hidden;
    }
    .meter-bar > span {
      display: block;
      height: 100%;
      background: var(--color-primary);
    }
  `,
})
export class EntryChoice {
  readonly items = input.required<readonly EntryChoiceItem[]>();
  readonly labelKey = input('entryChoice.label');
  /** link のないカードを押した（item.key） */
  readonly chosen = output<string>();
}
