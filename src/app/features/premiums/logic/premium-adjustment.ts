// 保険料調整制度（2026年10月〜。日本年金機構「保険料調整制度」R48）
// Angular・Firebase に依存しない純粋な関数
//
// - 対象：保険料調整を申し出た事業所の、短時間労働者として加入している人のうち、標準報酬月額が12.6万円以下の人
// - 軽減するのは健康保険料と厚生年金保険料だけ（介護保険料・子ども・子育て支援金・賞与は対象外）
// - 軽減の割合は標準報酬月額で決まる。制度を使い始めてから通算25〜36か月目は半分、37か月目からはなし
// - 本人負担 ＝ 折半の額 − 全額 × 軽減割合（銭まで。そのあと、ふだんどおり50銭の端数処理）
//   会社負担 ＝ 全額 − 本人負担（会社が一時的に多く払う）
// - 保険料軽減額 ＝ 全額 × 軽減割合 を小数点第一位で四捨五入（円）。会社が多く払った分で、3か月後の保険料から差し引かれる（還付）
//   例（機構の表）：厚年 98,000円 → 全額 17,934円、軽減額 3,587円、本人負担 5,380.20円、会社負担 12,553.80円
// - 組合健保の健康保険料は、組合ごとに扱いが違う（機構：各組合に問い合わせ）ので計算しない（厚年だけ軽減する）

import type { Milli } from '../../../core/models/premium';
import { shiftMonth } from '../../../shared/utils/date';

/** 軽減割合（1 ＝ 0.01%。2500 ＝ 25%） */
export type RatioBp = number;

/** 標準報酬月額ごとの軽減割合（1〜24か月目）。25〜36か月目は半分 */
const STEPS: readonly { maxStandard: number; bp: RatioBp }[] = [
  { maxStandard: 88000, bp: 2500 },
  { maxStandard: 98000, bp: 2000 },
  { maxStandard: 104000, bp: 1400 },
  { maxStandard: 110000, bp: 900 },
  { maxStandard: 118000, bp: 500 },
  { maxStandard: 126000, bp: 200 },
];

/** 対象になる標準報酬月額の上限（12.6万円） */
export const ADJUSTMENT_MAX_STANDARD = 126000;

/** 通算の何か月目か → 1：1〜24か月目、2：25〜36か月目、0：対象外（まだ・もう終わった） */
export type AdjustmentPhase = 0 | 1 | 2;

/** 軽減割合（対象外なら 0） */
export function adjustmentRatio(standard: number, phase: AdjustmentPhase): RatioBp {
  if (phase === 0) return 0;
  const step = STEPS.find((s) => standard <= s.maxStandard);
  if (!step) return 0;
  return phase === 1 ? step.bp : step.bp / 2;
}

/**
 * その月が、その人にとって通算で何か月目か
 * since：事業所が保険料調整を始めた月。eligibleAt(月)：その月に対象だったか（短時間労働者・12.6万円以下）
 * 対象だった月だけを数える（対象でない月をはさんでも、通算で数える）
 */
export function adjustmentPhase(
  month: string,
  since: string | null | undefined,
  eligibleAt: (month: string) => boolean,
): AdjustmentPhase {
  if (!since || month < since || !eligibleAt(month)) return 0;
  let n = 0;
  for (let m = since; m <= month; m = shiftMonth(m, 1)) {
    if (eligibleAt(m)) n++;
    if (n > 36) return 0;
  }
  return n <= 24 ? 1 : n <= 36 ? 2 : 0;
}

/** 全額（0.001円単位）× 軽減割合 → 本人分から引く額（0.001円単位。1円の1000分の1未満は四捨五入） */
export function reductionMilli(totalMilli: Milli, bp: RatioBp): Milli {
  return Math.round((totalMilli * bp) / 10000);
}

/** 保険料軽減額（会社が多く払った分。3か月後に差し引かれる）：小数点第一位で四捨五入して円 */
export function refundYen(reduction: Milli): number {
  return Math.round(reduction / 1000);
}

/** 1人1か月の軽減割合（健保・厚年べつ。対象外なら null） */
export interface AdjustmentInput {
  health: RatioBp;
  pension: RatioBp;
}

/** 3か月後に差し引かれる月（例：2026-10 分の軽減額 → 2027-01 分の保険料から） */
export function refundMonthOf(month: string): string {
  return shiftMonth(month, 3);
}
