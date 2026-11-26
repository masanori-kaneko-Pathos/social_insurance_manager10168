import { Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { MonthSpan, RateImpact, spansOf } from '../../logic/rate-impact';

/**
 * 組合の料率を保存したら計算が変わる月（11/26）
 * - 料率の窓の「取り込む」「保存する」「削除」の前に出す。止めはしない（知らせるだけ）
 * - 確認済みの月が含まれるときだけ注意の色
 */
@Component({
  selector: 'app-rate-impact-note',
  imports: [TranslocoPipe],
  template: `
    @if (impact(); as r) {
      @if (r.changed.length) {
        <div
          class="impact"
          [class.alert]="r.closed.length"
          [class.alert-warning]="r.closed.length"
          role="status"
        >
          <p>
            {{ 'rateImpact.changed' | transloco: { spans: changedText() } }}
            @if (r.changedCount !== null) {
              {{ 'rateImpact.count' | transloco: { n: r.changedCount } }}
            }
          </p>
          @if (r.closed.length) {
            <p>
              {{ 'rateImpact.closed' | transloco: { spans: closedText(), n: r.closed.length } }}
            </p>
            <p class="sub">{{ 'rateImpact.closedHint' | transloco }}</p>
          } @else if (closedError()) {
            <p class="sub">{{ 'rateImpact.loadError' | transloco }}</p>
          }
        </div>
      }
    } @else if (loading()) {
      <p class="impact sub">{{ 'rateImpact.loading' | transloco }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .impact {
      margin: 0 0 var(--space-sm);
    }
    .impact p {
      margin: 0;
    }
    .impact p + p {
      margin-top: var(--space-xs);
    }
    .alert-warning {
      background: var(--color-warning-bg);
      color: var(--color-warning-text);
      border: 1px solid var(--color-warning-border);
    }
    .sub {
      font-size: var(--font-sm);
      color: var(--color-text-sub);
    }
    .alert-warning .sub {
      color: inherit;
    }
  `,
})
export class RateImpactNote {
  /** 影響（まだ計算していなければ null） */
  readonly impact = input<RateImpact | null>(null);
  /** 確認済みの月を読んでいる途中 */
  readonly loading = input(false);
  /** 確認済みの月を読めなかった（変わる月だけ出す） */
  readonly closedError = input(false);

  private readonly transloco = inject(TranslocoService);

  readonly changedText = computed(() => this.join(this.impact()?.changed ?? []));
  readonly closedText = computed(() => this.join(spansOf(this.impact()?.closed ?? [])));

  private join(spans: readonly MonthSpan[]): string {
    return spans.map((s) => this.label(s)).join('、');
  }

  private label(s: MonthSpan): string {
    if (s.to === null) return this.transloco.translate('rateImpact.span.open', { from: s.from });
    if (s.to === s.from) return this.transloco.translate('rateImpact.span.one', { month: s.from });
    return this.transloco.translate('rateImpact.span.range', { from: s.from, to: s.to });
  }
}
