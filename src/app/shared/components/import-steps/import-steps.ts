import { Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

export type ImportStep = 'pick' | 'map' | 'check' | 'done';
const ORDER: readonly ImportStep[] = ['pick', 'map', 'check', 'done'];

/**
 * 取り込みの段階の印（11/17。課題管理アプリと同じ）：1.ファイルを選ぶ  2.列を合わせる  3.確かめる  4.取り込み済み
 * 見出しがうちの形のファイルは「列を合わせる」を飛ばす（印は薄いまま）
 */
@Component({
  selector: 'app-import-steps',
  imports: [TranslocoPipe],
  template: `
    <ol class="steps">
      @for (s of steps(); track s; let i = $index) {
        <li [class.on]="s === step()" [class.past]="isPast(s)">
          @if (isPast(s)) {
            <span aria-hidden="true">✓</span>
          }
          {{ i + 1 }}. {{ 'importSteps.' + s | transloco }}
        </li>
      }
    </ol>
  `,
  styles: `
    .steps {
      display: flex;
      flex-wrap: wrap;
      gap: 4px var(--space-md);
      margin: 0 0 var(--space-md);
      padding: 0;
      list-style: none;
      font-size: var(--font-sm);
      color: var(--color-text-sub);
    }
    .steps li.on {
      color: var(--color-primary-text, var(--color-text));
      font-weight: 700;
      border-bottom: 2px solid var(--color-primary);
    }
    .steps li.past {
      color: var(--color-text);
    }
  `,
})
export class ImportSteps {
  readonly step = input.required<ImportStep>();
  /** 列を合わせる段があるか（マイナンバーなどはない） */
  readonly hasMap = input(true);
  readonly steps = computed(() => (this.hasMap() ? ORDER : ORDER.filter((s) => s !== 'map')));

  isPast(s: ImportStep): boolean {
    return ORDER.indexOf(s) < ORDER.indexOf(this.step());
  }
}
