import { Component, computed, input, model } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { PAGE_SIZES, PageSize } from '../../logic/person-list';

/**
 * ページ送り（人の並ぶ表の上と下。11/13）
 * 「1〜100人目 / 523人」「‹ 1 2 3 … 6 ›」「表示 100人 ▾」
 * 表示人数を変えたら、親が1ページ目に戻す
 */
@Component({
  selector: 'app-pager',
  imports: [TranslocoPipe],
  template: `
    <div class="pager">
      <span class="range">
        @if (total() > 0) {
          {{ 'pager.range' | transloco: { from: from(), to: to(), total: total() } }}
        } @else {
          {{ 'pager.none' | transloco }}
        }
      </span>
      @if (pages() > 1) {
        <nav class="pages" [attr.aria-label]="'pager.label' | transloco">
          <button type="button" class="pg" [disabled]="page() <= 1" (click)="go(page() - 1)" [attr.aria-label]="'pager.prev' | transloco">‹</button>
          @for (p of numbers(); track $index) {
            @if (p === 0) {
              <span class="gap">…</span>
            } @else {
              <button type="button" class="pg" [class.on]="p === page()" [attr.aria-current]="p === page() ? 'page' : null" (click)="go(p)">{{ p }}</button>
            }
          }
          <button type="button" class="pg" [disabled]="page() >= pages()" (click)="go(page() + 1)" [attr.aria-label]="'pager.next' | transloco">›</button>
        </nav>
      }
      @if (showSize()) {
        <label class="size">
          <span>{{ 'pager.size' | transloco }}</span>
          <select class="input" (change)="setSize($any($event.target).value)">
            @for (s of sizes; track s) {
              <option [value]="s" [selected]="s === size()">{{ 'pager.sizeOpt' | transloco: { n: s } }}</option>
            }
          </select>
        </label>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .pager { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs) var(--space-md); font-size: var(--font-sm); }
    .range { color: var(--color-text-sub); font-variant-numeric: tabular-nums; }
    .pages { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; }
    .pg { min-width: 32px; height: 32px; padding: 0 6px; font: inherit; font-size: var(--font-sm); color: var(--color-text); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); cursor: pointer; font-variant-numeric: tabular-nums; }
    .pg:hover:not(:disabled) { background: var(--color-hover); }
    .pg.on { color: var(--color-on-primary); background: var(--color-primary); border-color: var(--color-primary); font-weight: 600; }
    .pg:disabled { opacity: 0.4; cursor: default; }
    .gap { padding: 0 4px; color: var(--color-text-sub); }
    .size { display: inline-flex; align-items: center; gap: var(--space-xs); color: var(--color-text-sub); }
    .size .input { width: auto; }
    .pages + .size { margin-left: 0; }
    .range + .size { margin-left: auto; }
  `,
})
export class Pager {
  readonly total = input.required<number>();
  readonly page = model.required<number>();
  readonly size = model.required<PageSize>();
  /** 表示人数の選択を出すか（表の下のページ送りでは出さない） */
  readonly showSize = input(true);

  readonly sizes = PAGE_SIZES;
  readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.size())));
  readonly from = computed(() => (this.page() - 1) * this.size() + 1);
  readonly to = computed(() => Math.min(this.total(), this.page() * this.size()));

  /** 出す番号（0 ＝「…」）：最初・最後・今のページの前後2つ */
  readonly numbers = computed(() => {
    const n = this.pages();
    const cur = this.page();
    const keep = new Set([1, n, cur - 2, cur - 1, cur, cur + 1, cur + 2].filter((p) => p >= 1 && p <= n));
    const sorted = [...keep].sort((a, b) => a - b);
    const out: number[] = [];
    sorted.forEach((p, i) => {
      if (i > 0 && p - sorted[i - 1] > 1) out.push(0);
      out.push(p);
    });
    return out;
  });

  go(p: number): void {
    this.page.set(Math.min(Math.max(1, p), this.pages()));
  }

  setSize(v: string): void {
    const n = Number(v) as PageSize;
    if (!PAGE_SIZES.includes(n)) return;
    // 1ページ目に戻すのは親の仕事（URL に持つ画面で、2回続けて書き換えないように）
    this.size.set(n);
  }
}
