// 標準報酬の改定（随時改定・休業終了時改定。いずれ定時決定も）で共通の部品
// Angular・Firebase に依存しない純粋な関数
//
// 根拠：日本年金機構「算定基礎届の記入・提出ガイドブック」令和8年度版
// - 支払基礎日数の基準：17日（特定適用事業所の短時間労働者は11日）。区分は月ごとに、給与計算期間の末日で判断（Q21・Q22）
// - 平均は遡及支払額を除き、1円未満切り捨て（26ページの記入例、Q26）

import type { GradeRow } from '../../../core/models/rates';
import type { Payroll } from '../../../core/models/payroll';
import type { StandardRemuneration } from '../../../core/models/remuneration';
import { gradeOf } from '../../rates/logic/grade';
import type { Category } from '../../employees/logic/classify';
import type { GradeRows, Remuneration } from './regular';

export const MIN_DAYS = 17;
export const MIN_DAYS_SHORT_TIME = 11;
/** 短時間就労者（パート）：17日の月がないときに使える下限（定時決定・休業終了時改定） */
export const MIN_DAYS_PART_FALLBACK = 15;

/** その月の区分 → 支払基礎日数の基準（判定できない月は17日） */
export function minDaysOf(category: Category | null): number {
  return category === 'shortTime' ? MIN_DAYS_SHORT_TIME : MIN_DAYS;
}

/** 1か月分の材料（支払った月ごと） */
export interface RevisionMonth {
  month: string; // 支払った月
  payroll: Payroll | null;
  /** 通貨＋現物 */
  amount: number;
  /** その月の支払基礎日数の基準（17 か 11） */
  minDays: number;
  /** 平均に使ったか */
  used: boolean;
}

/** 合計・平均（平均は1円未満切り捨て。修正平均は遡及支払額を引いたもの） */
export interface Average {
  total: number; // 使った月の通貨＋現物の合計（届の「総計」）
  retro: number; // 使った月の遡及支払額の合計
  average: number; // 届の「平均額」
  corrected: number; // 遡及を引いた「修正平均額」（遡及がなければ average と同じ）
}

export function averageOfMonths(months: RevisionMonth[]): Average | null {
  const used = months.filter((m) => m.used && m.payroll);
  if (used.length === 0) return null;
  const total = used.reduce((s, m) => s + m.amount, 0);
  const retro = used.reduce((s, m) => s + (m.payroll?.retro ?? 0), 0);
  return {
    total,
    retro,
    average: Math.floor(total / used.length),
    corrected: Math.floor((total - retro) / used.length),
  };
}

/** 1つの保険（健保か厚年）の判定 */
export interface InsuranceJudgement {
  before: StandardRemuneration;
  after: StandardRemuneration;
  /** after − before（等級） */
  diff: number;
  /** 上限・下限の特例（1等級差でも改定）に当たった */
  special: boolean;
  /** 改定する */
  revise: boolean;
}

/** その月分に使う標準報酬（from がその月以前で一番新しいもの） */
export function standardAt(list: readonly Remuneration[], month: string): Remuneration | null {
  let found: Remuneration | null = null;
  for (const r of list) if (r.from <= month && (!found || r.from > found.from)) found = r;
  return found;
}

/** 等級表から、平均に当たる標準報酬 */
export function judgeOne(
  rows: GradeRow[],
  before: StandardRemuneration,
  amount: number,
): Omit<InsuranceJudgement, 'special' | 'revise'> {
  const after = gradeOf(rows, amount);
  return { before, after, diff: after.grade - before.grade };
}

export type { GradeRows };
