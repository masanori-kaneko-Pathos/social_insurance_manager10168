import { Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from '../../../core/i18n/language.service';
import { YearMonth } from '../../utils/date';

/**
 * 月の見出し（中身は呼ぶ側が <ng-content> で渡す）と、押すと開く「年と12か月」の選び窓
 * 選んだ月（'YYYY-MM'）を知らせるだけ。どう移るか（URL を書き換える・別の画面へ）は、呼ぶ側が決める
 * （課題管理アプリの month-picker を、この アプリの色と翻訳に合わせて移したもの）
 */
@Component({
  selector: 'app-month-picker',
  imports: [TranslocoPipe],
  host: { '(document:keydown.escape)': 'open.set(false)' },
  template: `
    <button
      type="button"
      class="title"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="'monthPicker.pick' | transloco"
      (click)="toggle()"
    >
      <span class="label"><ng-content /></span>
      <span class="caret" aria-hidden="true">▾</span>
    </button>
    @if (open()) {
      <div class="backdrop" (click)="open.set(false)"></div>
      <div class="picker" role="dialog" [attr.aria-label]="'monthPicker.pick' | transloco">
        <div class="picker-head">
          <button type="button" class="arrow" [attr.aria-label]="'monthPicker.prevYear' | transloco" (click)="year.set(year() - 1)">‹</button>
          <strong>{{ yearLabel() }}</strong>
          <button type="button" class="arrow" [attr.aria-label]="'monthPicker.nextYear' | transloco" (click)="year.set(year() + 1)">›</button>
        </div>
        <div class="months">
          @for (m of monthNames(); track $index; let k = $index) {
            <button
              type="button"
              [class.on]="isShown(k)"
              [class.now]="isThisMonth(k)"
              [attr.aria-current]="isShown(k) ? 'date' : null"
              (click)="pick(k)"
            >
              {{ m }}
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: inline-block; }
    .title { display: inline-flex; align-items: center; gap: var(--space-xs); min-height: 40px; padding: 0 var(--space-sm);
      border: none; border-radius: var(--radius-md); background: none; color: var(--color-text);
      font: inherit; font-weight: 600; cursor: pointer; }
    .title:hover { background: var(--color-bg); }
    .label { text-align: center; }
    .caret { font-size: 11px; color: var(--color-text-sub); }
    .backdrop { position: fixed; inset: 0; z-index: 51; }
    .picker { position: absolute; top: calc(100% + 4px); left: 50%; transform: translateX(-50%); z-index: 52;
      width: 264px; padding: 10px; background: var(--color-surface); border: 1px solid var(--color-border);
      border-radius: var(--radius-lg); box-shadow: var(--shadow-popover); }
    .picker-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .arrow { width: 36px; height: 36px; border: none; border-radius: 50%; background: none; color: var(--color-text);
      font-size: 20px; line-height: 1; cursor: pointer; }
    .arrow:hover { background: var(--color-bg); }
    .months { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
    .months button { min-height: 40px; border: none; border-radius: var(--radius-md); background: none;
      color: var(--color-text); font-size: 13px; cursor: pointer; }
    .months button:hover { background: var(--color-bg); }
    .months button.now { color: var(--color-primary-hover); font-weight: bold; }
    .months button.on { background: var(--color-primary); color: var(--color-on-primary); }
  `,
})
export class MonthPicker {
  /** 今見ている月（'YYYY-MM'） */
  readonly value = input.required<YearMonth>();
  /** 今月（選び窓で太字に） */
  readonly today = input.required<YearMonth>();
  /** 選んだ月 */
  readonly picked = output<YearMonth>();

  private readonly language = inject(LanguageService);
  readonly open = signal(false);
  /** 選び窓で見ている年（開くたびに、今見ている年に戻す） */
  readonly year = signal(2026);
  private readonly locale = computed(() => (this.language.lang() === 'en' ? 'en-US' : 'ja-JP'));

  /** 1月〜12月の名前（日本語なら「1月」、英語なら「Jan」） */
  readonly monthNames = computed(() => {
    const fmt = new Intl.DateTimeFormat(this.locale(), { month: 'short', timeZone: 'UTC' });
    return Array.from({ length: 12 }, (_, k) => fmt.format(new Date(Date.UTC(2026, k, 1))));
  });
  readonly yearLabel = computed(() =>
    new Intl.DateTimeFormat(this.locale(), { year: 'numeric', timeZone: 'UTC' }).format(
      new Date(Date.UTC(this.year(), 0, 1)),
    ),
  );

  toggle(): void {
    if (!this.open()) this.year.set(Number(this.value().slice(0, 4)));
    this.open.set(!this.open());
  }

  /** 'YYYY-MM' が、選び窓で見ている年の k 月か */
  private same(month: YearMonth, k: number): boolean {
    return Number(month.slice(0, 4)) === this.year() && Number(month.slice(5, 7)) - 1 === k;
  }

  isShown(k: number): boolean {
    return this.same(this.value(), k);
  }

  isThisMonth(k: number): boolean {
    return this.same(this.today(), k);
  }

  pick(k: number): void {
    this.open.set(false);
    this.picked.emit(`${this.year()}-${String(k + 1).padStart(2, '0')}`);
  }
}
