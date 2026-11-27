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
  /** 特定被保険者の理由になった扶養家族の氏名（分かるときだけ。11/27） */
  readonly specialNames = input<readonly string[]>([]);
  /** 計算式（右側）も出すか。従業員の社会保険のまとめでは明細だけ（計算式は下の保険料のカードで見られる。11/25） */
  readonly formula = input(true);
  readonly slip = computed(() => premiumSlip(this.result()));
  /** 合算して端数処理した単位を、保険ごとに差し引きで分けているか（明細の下に説明を出す。11/24） */
  readonly hasParts = computed(() => this.result().groups.some((g) => !!g.partsYen));

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
