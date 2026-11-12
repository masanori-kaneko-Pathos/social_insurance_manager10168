import { Component, input } from '@angular/core';

export type IconName =
  | 'home'
  | 'todo'
  | 'people'
  | 'payroll'
  | 'premium'
  | 'bonus'
  | 'revision'
  | 'regular'
  | 'settings'
  | 'inbox'
  | 'filing'
  | 'calendar'
  | 'help'
  | 'request' // 依頼・申請（封筒）
  | 'userPlus' // 従業員を登録
  | 'upload' // ファイルから取り込む
  | 'admin'; // 管理者（鍵）

/**
 * 小さな線画のアイコン（16px。色は文字色をそのまま使う）
 * 外の部品を入れずに、ここで SVG を描く。飾りなので読み上げない（aria-hidden）
 */
@Component({
  selector: 'app-icon',
  template: `
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      @switch (name()) {
        @case ('home') {
          <path d="M2 7.5L8 2.5l6 5" />
          <path d="M3.5 6.5v7h3.5v-4h2v4h3.5v-7" />
        }
        @case ('todo') {
          <path d="M2.5 4.5l1.5 1.5 2.5-3" />
          <path d="M8.5 4.5h5" />
          <path d="M2.5 11l1.5 1.5 2.5-3" />
          <path d="M8.5 11h5" />
        }
        @case ('people') {
          <circle cx="6" cy="5" r="2.5" />
          <path d="M1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
          <path d="M10.5 2.8a2.3 2.3 0 0 1 0 4.4" />
          <path d="M12 9.6c1.5.5 2.5 1.8 2.5 3.9" />
        }
        @case ('payroll') {
          <path d="M3.5 1.5h9v13l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1z" />
          <path d="M6 5h4M6 8h4" />
        }
        @case ('premium') {
          <circle cx="8" cy="8" r="6.5" />
          <path d="M5.5 4.5L8 8l2.5-3.5M8 8v3.5M6 8.5h4M6 10h4" />
        }
        @case ('bonus') {
          <rect x="2" y="6" width="12" height="3" rx="0.5" />
          <path d="M3 9v5.5h10V9M8 6v8.5" />
          <path d="M8 6C6.5 6 4.5 5.5 4.5 4S6.5 2.5 8 6zM8 6c1.5 0 3.5-.5 3.5-2S9.5 2.5 8 6z" />
        }
        @case ('revision') {
          <path d="M4.5 13V3M2 5.5L4.5 3 7 5.5" />
          <path d="M11.5 3v10M9 10.5l2.5 2.5 2.5-2.5" />
        }
        @case ('regular') {
          <!-- 定時決定：4〜6月の報酬を並べる（棒グラフ。暦と見分ける） -->
          <path d="M2 14h12" />
          <rect x="3" y="8" width="2.5" height="6" />
          <rect x="6.75" y="5" width="2.5" height="9" />
          <rect x="10.5" y="9.5" width="2.5" height="4.5" />
        }
        @case ('settings') {
          <path d="M2 4.5h7M12.5 4.5h1.5M2 11.5h1.5M7 11.5h7" />
          <circle cx="10.75" cy="4.5" r="1.75" />
          <circle cx="5.25" cy="11.5" r="1.75" />
        }
        @case ('inbox') {
          <path d="M2 9.5l2-6.5h8l2 6.5v4H2z" />
          <path d="M2 9.5h3.5l1 1.5h3l1-1.5H14" />
        }
        @case ('calendar') {
          <rect x="2" y="3" width="12" height="11" rx="1.5" />
          <path d="M2 6.5h12M5 1.5v3M11 1.5v3" />
          <path d="M5 9h1.5M8 9h1.5M11 9h0.5M5 11.5h1.5M8 11.5h1.5" />
        }
        @case ('filing') {
          <path d="M4 1.5h5.5L12.5 4.5v10h-8.5z" />
          <path d="M9.5 1.5v3h3M6 7.5h4.5M6 10h4.5M6 12.5h3" />
        }
        @case ('request') {
          <rect x="1.5" y="3.5" width="13" height="9" rx="1" />
          <path d="M1.5 4.5L8 9l6.5-4.5" />
        }
        @case ('userPlus') {
          <circle cx="6" cy="5" r="2.5" />
          <path d="M1.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
          <path d="M12.5 4.5v4M10.5 6.5h4" />
        }
        @case ('upload') {
          <path d="M2 10.5v3h12v-3" />
          <path d="M8 10V2.5M5 5.5l3-3 3 3" />
        }
        @case ('admin') {
          <circle cx="5.5" cy="8" r="3" />
          <path d="M8.5 8h6M12.5 8v2.5M14.5 8v2" />
        }
        @case ('help') {
          <circle cx="8" cy="8" r="6.25" />
          <path d="M6.2 6.2a1.9 1.9 0 0 1 3.6.8c0 1.3-1.8 1.6-1.8 2.8" />
          <path d="M8 11.8v.01" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-shrink: 0;
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
}
