import { Component, ElementRef, inject, input, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * ヘッダーのベル：数字の印と、押すと開く小窓（中身は使う側が入れる）
 * - 管理者：To-do の件数と確認待ちの依頼（office-shell）
 * - 従業員：受信箱の未読（me-header）
 * 小窓の外を押したとき・小窓の中のリンクやボタンを押したときに閉じる
 */
@Component({
  selector: 'app-bell',
  imports: [TranslocoPipe],
  host: { '(document:click)': 'onDocumentClick($event)' },
  template: `
    <details #box class="bell">
      <summary [attr.aria-label]="label() | transloco">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        @if (count() > 0) {
          <span class="dot">{{ count() > 99 ? '99+' : count() }}</span>
        }
      </summary>
      <div class="panel" (click)="onPanelClick($event)">
        <ng-content />
      </div>
    </details>
  `,
  styles: `
    .bell { position: relative; }
    summary {
      position: relative;
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      color: var(--color-text);
      border-radius: var(--radius-sm);
      list-style: none;
      cursor: pointer;
    }
    summary::-webkit-details-marker { display: none; }
    summary:hover { background: var(--color-bg); }
    .dot {
      position: absolute;
      top: 2px;
      right: 0;
      min-width: 16px;
      padding: 0 4px;
      font-size: 10px;
      font-weight: 600;
      line-height: 16px;
      text-align: center;
      color: var(--color-on-danger);
      background: var(--color-danger-text);
      border-radius: 999px;
    }
    .panel {
      position: absolute;
      right: 0;
      z-index: 30;
      width: min(340px, calc(100vw - 24px));
      max-height: 70vh;
      overflow: auto;
      margin-top: var(--space-xs);
      padding: var(--space-sm);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-popover);
    }
  `,
})
export class Bell {
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly count = input(0);
  readonly label = input('bell.label');
  private readonly box = viewChild.required<ElementRef<HTMLDetailsElement>>('box');

  close(): void {
    this.box().nativeElement.open = false;
  }

  onDocumentClick(e: MouseEvent): void {
    if (!this.host.nativeElement.contains(e.target as Node)) this.close();
  }

  /** 小窓の中のリンク・ボタンを押したら閉じる（押した先の処理はそのまま動く） */
  onPanelClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('a, button')) this.close();
  }
}
