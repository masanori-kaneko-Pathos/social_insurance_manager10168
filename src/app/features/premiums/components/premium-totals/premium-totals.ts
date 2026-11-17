import { Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { PremiumResult } from '../../../../core/models/premium';
import { healthPartTotals, officeTotals } from '../../logic/premium-core';

/**
 * 保険料の合計（保険料一覧と賞与で同じ形。11/17）
 * - ふだんは1行の帯（人数・本人負担・会社負担・納付額）。開くと保険ごとの表
 * - 列の並びは「本人負担 → 会社負担 → 納付額」。健康保険等は、健康保険・介護・支援金の全額も出す
 * - 調整制度の差し引き（月額だけ）は refund で渡す。部署の小計などは中身（ng-content）で足す
 */
@Component({
  selector: 'app-premium-totals',
  imports: [TranslocoPipe],
  templateUrl: './premium-totals.html',
  styleUrl: './premium-totals.css',
})
export class PremiumTotals {
  /** 計算できた人の結果 */
  readonly results = input.required<readonly PremiumResult[]>();
  /** 計算できなかった人数（合計に入っていない） */
  readonly excluded = input(0);
  readonly titleKey = input('premiumList.totalsTitle');
  readonly hintKey = input('premiumList.totalsHint');
  /** 保険料調整制度：3か月前の軽減額（この月の納付額から差し引かれる） */
  readonly refund = input<{ month: string; health: number; pension: number } | null>(null);
  readonly open = input(false);

  readonly totals = computed(() => officeTotals([...this.results()]));
  readonly healthParts = computed(() => healthPartTotals([...this.results()]));
  readonly paymentYen = computed(() => this.totals().reduce((s, t) => s + t.totalYen, 0));
  readonly employeeYen = computed(() => this.totals().reduce((s, t) => s + t.employeeYen, 0));
  readonly employerYen = computed(() => this.totals().reduce((s, t) => s + t.employerYen, 0));

  readonly yen = (n: number) => n.toLocaleString('ja-JP');
}
