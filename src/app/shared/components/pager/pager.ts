import { Component, computed, ElementRef, inject, input, model, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { PAGE_SIZES, PageSize } from '../../logic/person-list';

/**
 * ページ送り（人の並ぶ表。11/13 に作り直し）
 * - 上（variant="top"）：薄い帯に「全 245人中 41〜60人を表示」と「1ページの表示人数」の選択
 * - 下（variant="bottom"）：番号のページ送り（前へ・番号・次へ）と「（13ページ中 3ページ目）」
 *   画面の下に貼り付く帯（sticky）にして、表の途中でもページを移れる。「上へ戻る」つき
 * - 番号は数が変わらない（7つ。… をはさむ）ので、ページを移っても帯の幅が動かない
 * - 表示人数を変えたら、今見ている先頭の1人が入るページへ（resized で size と page を一緒に知らせる）
 * - 下でページを移ったら、上の件数の表示にフォーカスを移す（表の先頭から読み直せる）
 */
@Component({
  selector: 'app-pager',
  imports: [TranslocoPipe],
  template: `
    @if (variant() === 'top') {
      <div class="band top">
        <p class="summary" tabindex="-1" data-pager-summary>
          @if (total() > 0) {
            <span class="total">{{ 'pager.totalPrefix' | transloco }}<strong>{{ total().toLocaleString() }}</strong>{{ 'pager.totalSuffix' | transloco }}</span>
            <span class="range">{{ 'pager.showing' | transloco: { from: from(), to: to() } }}</span>
          } @else {
            <span class="range">{{ 'pager.none' | transloco }}</span>
          }
        </p>
        <label class="size">
          <span>{{ 'pager.size' | transloco }}</span>
          <select class="input" (change)="setSize($any($event.target).value)">
            @for (s of sizes; track s) {
              <option [value]="s" [selected]="s === size()">{{ 'pager.sizeOpt' | transloco: { n: s } }}</option>
            }
          </select>
        </label>
      </div>
    } @else if (pages() > 1) {
      <div class="band bottom">
        <nav class="pages" [attr.aria-label]="'pager.label' | transloco">
          <button type="button" class="pg wide" [disabled]="page() <= 1" (click)="go(page() - 1)">‹ {{ 'pager.prev' | transloco }}</button>
          @for (p of numbers(); track $index) {
            @if (p === 0) {
              <span class="pg gap" aria-hidden="true">…</span>
            } @else {
              <button type="button" class="pg" [class.on]="p === page()" [attr.aria-current]="p === page() ? 'page' : null" (click)="go(p)">{{ p }}</button>
            }
          }
          <button type="button" class="pg wide" [disabled]="page() >= pages()" (click)="go(page() + 1)">{{ 'pager.next' | transloco }} ›</button>
        </nav>
        <span class="where">{{ 'pager.where' | transloco: { total: total(), from: from(), to: to(), pages: pages(), page: page() } }}</span>
        <button type="button" class="to-top" (click)="toTop()">↑ {{ 'pager.toTop' | transloco }}</button>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .band { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm) var(--space-md); font-size: var(--font-sm); }
    .top { padding: var(--space-sm) var(--space-md); background: color-mix(in srgb, var(--color-highlight) 35%, transparent); border-radius: var(--radius-md); }
    .summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-sm); margin: 0; outline-offset: 4px; }
    .total strong { margin: 0 2px; font-size: var(--font-xl); font-variant-numeric: tabular-nums; color: var(--color-text-strong); }
    .range { color: var(--color-text-sub); font-variant-numeric: tabular-nums; }
    .size { display: inline-flex; align-items: center; gap: var(--space-xs); margin-left: auto; color: var(--color-text-sub); }
    .size .input { width: auto; }
    /* 下の帯：画面の下に貼り付く */
    .bottom { position: sticky; bottom: 0; z-index: 5; justify-content: center; padding: var(--space-sm) var(--space-md); background: color-mix(in srgb, var(--color-bg) 92%, transparent); backdrop-filter: blur(4px); border-top: 1px solid var(--color-border); }
    .pages { display: inline-flex; align-items: center; gap: var(--space-xs); }
    .pg { box-sizing: border-box; width: 44px; height: 44px; padding: 0; font: inherit; font-size: var(--font-sm); color: var(--color-text); background: var(--color-surface); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); cursor: pointer; font-variant-numeric: tabular-nums; }
    .pg.wide { width: 6.5em; font-weight: 600; }
    .pg:hover:not(:disabled):not(.gap) { background: var(--color-hover); }
    .pg.on { color: var(--color-on-primary); background: var(--color-primary); border-color: var(--color-primary); font-weight: 700; }
    .pg:disabled { opacity: 0.35; cursor: default; }
    .pg.gap { display: inline-flex; align-items: center; justify-content: center; border-color: transparent; background: none; color: var(--color-text-sub); cursor: default; }
    .where { color: var(--color-text-sub); font-variant-numeric: tabular-nums; }
    .to-top { padding: 0; font: inherit; font-size: var(--font-sm); color: var(--color-primary); background: none; border: 0; text-decoration: underline; cursor: pointer; }
  `,
})
export class Pager {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly variant = input<'top' | 'bottom'>('top');
  readonly total = input.required<number>();
  readonly page = model.required<number>();
  readonly size = model.required<PageSize>();
  /** 表示人数を変えたとき（新しい人数と、先頭の1人が入るページ）。URL に持つ画面は、これで1回だけ書き換える */
  readonly resized = output<{ size: PageSize; page: number }>();

  readonly sizes = PAGE_SIZES;
  readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.size())));
  readonly from = computed(() => Math.min(this.total(), (this.page() - 1) * this.size() + 1));
  readonly to = computed(() => Math.min(this.total(), this.page() * this.size()));

  /**
   * 出す番号（0 ＝「…」）。7ページを超えたら、いつも7つ（幅が変わらないように）
   * 例：13ページの3ページ目 → 1 2 3 4 5 … 13、7ページ目 → 1 … 6 7 8 … 13
   */
  readonly numbers = computed(() => {
    const n = this.pages();
    const c = this.page();
    if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
    if (c <= 4) return [1, 2, 3, 4, 5, 0, n];
    if (c >= n - 3) return [1, 0, n - 4, n - 3, n - 2, n - 1, n];
    return [1, 0, c - 1, c, c + 1, 0, n];
  });

  go(p: number): void {
    const next = Math.min(Math.max(1, p), this.pages());
    if (next === this.page()) return;
    this.page.set(next);
    this.toTop();
  }

  /** 表の上の件数の表示へ（フォーカスを移すと、そこまで画面が戻る） */
  toTop(): void {
    setTimeout(() => {
      // 同じ画面の中で、この帯より前にある件数の表示（なければ画面の先頭）
      const all = Array.from(document.querySelectorAll<HTMLElement>('[data-pager-summary]'));
      const mine = all.filter((el) => el.compareDocumentPosition(this.host.nativeElement) & Node.DOCUMENT_POSITION_FOLLOWING);
      const target = mine[mine.length - 1] ?? all[0];
      if (target) target.focus();
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  setSize(v: string): void {
    const n = Number(v) as PageSize;
    if (!PAGE_SIZES.includes(n)) return;
    // 今見ている先頭の1人が、新しい表示人数で何ページ目に入るか
    const first = (this.page() - 1) * this.size();
    const page = Math.floor(first / n) + 1;
    this.size.set(n);
    this.page.set(page);
    this.resized.emit({ size: n, page });
  }
}
