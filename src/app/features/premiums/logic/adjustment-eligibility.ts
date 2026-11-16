// 保険料調整制度：その人・その月の軽減割合を決める（11/16）
// Angular・Firebase に依存しない純粋な関数。計算の決まりは premium-adjustment.ts
//
// 対象の月 ＝ 次の全部
// - 事業所が保険料調整を始めた月（premiumAdjustment.since）以後
// - その月の末日に、短時間労働者の区分（特定減額特例の人を含む）
// - その保険に加入して保険料がかかる月で、標準報酬月額が12.6万円以下
// 組合健保の月は、健保の軽減をしない（組合ごとに扱いが違うため。厚年だけ軽減）

import type { ClassifyCriteria, ClassifyOffice, ClassifyPerson } from '../../employees/logic/classify';
import { classify } from '../../employees/logic/classify';
import { CoverageInput, coverageForMonth } from '../../employees/logic/coverage';
import { latest } from '../../rates/logic/pick-rates';
import { daysInMonth } from '../../../shared/utils/date';
import type { RemunerationLike } from './calc-monthly';
import {
  ADJUSTMENT_MAX_STANDARD,
  AdjustmentInput,
  adjustmentPhase,
  adjustmentRatio,
} from './premium-adjustment';

export interface AdjustmentContext {
  since: string | null;
  person: ClassifyPerson;
  employee: CoverageInput;
  remunerations: RemunerationLike[];
  office: ClassifyOffice;
  criteria: ClassifyCriteria[];
  /** その月が組合健保か（組合の月は健保を軽減しない） */
  kumiaiAt: (month: string) => boolean;
}

/** 月ごとの軽減割合を返す関数（対象でない月は null） */
export function adjustmentResolver(x: AdjustmentContext): (month: string) => AdjustmentInput | null {
  if (!x.since) return () => null;
  const cache = new Map<string, { health: boolean; pension: boolean; h: number; p: number }>();
  const stateAt = (month: string) => {
    const hit = cache.get(month);
    if (hit) return hit;
    const end = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
    const c = classify(x.person, x.office, x.criteria, end);
    const shortTime = c.category === 'shortTime' || c.category === 'reducedWage';
    const cov = coverageForMonth(x.employee, month);
    const rem = latest(x.remunerations, month);
    const h = rem?.health.standard ?? Infinity;
    const p = rem?.pension.standard ?? Infinity;
    const s = {
      health: shortTime && cov.health && h <= ADJUSTMENT_MAX_STANDARD,
      pension: shortTime && cov.pension && p <= ADJUSTMENT_MAX_STANDARD,
      h,
      p,
    };
    cache.set(month, s);
    return s;
  };
  const eligibleAt = (m: string) => {
    const s = stateAt(m);
    return s.health || s.pension;
  };
  return (month: string) => {
    const phase = adjustmentPhase(month, x.since, eligibleAt);
    if (phase === 0) return null;
    const s = stateAt(month);
    const health = s.health && !x.kumiaiAt(month) ? adjustmentRatio(s.h, phase) : 0;
    const pension = s.pension ? adjustmentRatio(s.p, phase) : 0;
    return health || pension ? { health, pension } : null;
  };
}
