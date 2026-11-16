import { Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { PremiumGroup, PremiumLine, PremiumResult } from '../../../../core/models/premium';
import { formatPercent } from '../../../rates/logic/rate-format';
import { premiumSlip } from '../../logic/premium-slip';
import { formatMilli } from '../../logic/rounding';

/**
 * 1人・1か月の保険料の内訳
 * - 先に給与明細の形（保険ごとに 本人・会社・全額）。「いくら引かれるか」がひと目でわかるように（11/16）
 * - 計算式（等級・料率・端数処理の前後）は「計算式を見る」で開く。従業員に「なんでこの額？」と聞かれたとき用
 * 保険料一覧の行の下に開く（11/13）
 */
@Component({
  selector: 'app-premium-breakdown',
  imports: [TranslocoPipe],
  templateUrl: './premium-breakdown.html',
  styleUrl: './premium-breakdown.css',
})
export class PremiumBreakdown {
  readonly result = input.required<PremiumResult>();
  readonly slip = computed(() => premiumSlip(this.result()));

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
