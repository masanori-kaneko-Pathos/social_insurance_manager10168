import { StandardRemuneration } from './remuneration';

/** 定時決定の決め方：通常（4〜6月の平均）／年間平均（保険者算定）／従前のまま（3か月とも使えない） */
export type RegularMethod = 'normal' | 'annual' | 'keep';

/**
 * 定時決定の記録（1人 × 1年 ＝ 1件）
 * 置き場所：offices/{officeId}/employees/{employeeId}/regularDecisions/{YYYY}
 * 標準報酬そのものは remunerations/{YYYY-09}（reason: 'regular'）に入れる。ここは「どう決めたか」の記録。
 * 算定基礎届の ⑭総計・⑮平均額・⑯修正平均額・⑱備考（年間平均）の材料にする
 */
export interface RegularDecision {
  officeId: string;
  employeeId: string;
  year: string; // 'YYYY'（＝ ドキュメントID）
  method: RegularMethod;
  /** 平均に使った月（支払った月） */
  usedMonths: string[];
  /** ⑭総計（使った月の通貨＋現物） */
  total: number;
  /** ⑮平均額 */
  average: number;
  /** ⑯修正平均額（遡及支払があったときだけ） */
  corrected: number | null;
  /** 年間平均（年間平均の候補だったときだけ） */
  annualAverage: number | null;
  /** 等級を決めた報酬月額 */
  monthlyAmount: number;
  /** 年間平均：業務の性質上、例年発生する */
  seasonal: boolean;
  /** 年間平均：被保険者が同意した */
  consent: boolean;
  health: StandardRemuneration;
  pension: StandardRemuneration;
}
