import { Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { PremiumGroup, PremiumLine, PremiumResult } from '../../../../core/models/premium';
import { formatPercent } from '../../../rates/logic/rate-format';
import { formatMilli } from '../../logic/rounding';

/**
 * 1人・1か月の計算の根拠（等級・料率・式と、端数処理の前後）
 * 保険料一覧の行の下に開く（11/13）。従業員のページの保険料の表と同じ見せ方
 */
@Component({
  selector: 'app-premium-breakdown',
  imports: [TranslocoPipe],
  templateUrl: './premium-breakdown.html',
  styleUrl: './premium-breakdown.css',
})
export class PremiumBreakdown {
  readonly result = input.required<PremiumResult>();

  isContribution(g: PremiumGroup): boolean {
    return g.parts.includes('childContribution');
  }

  /** グループの本人分（端数処理の前） */
  employeeBefore(g: PremiumGroup): string {
    return formatMilli(g.lines.reduce((s, l) => s + l.employeeMilli, 0));
  }

  lineRate(l: PremiumLine): string {
    return formatPercent(l.rate.employee + l.rate.employer);
  }

  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  readonly milli = formatMilli;
  readonly pct = formatPercent;
}
