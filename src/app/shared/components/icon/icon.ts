import { Component, input } from '@angular/core';

export type IconName =
  | 'todo'
  | 'people'
  | 'payroll'
  | 'premium'
  | 'bonus'
  | 'revision'
  | 'regular'
  | 'settings'
  | 'inbox';

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
          <rect x="2" y="3" width="12" height="11" rx="1.5" />
          <path d="M2 6.5h12M5 1.5v3M11 1.5v3" />
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
