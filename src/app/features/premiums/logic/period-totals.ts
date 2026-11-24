// 期間ごとの会社負担の集計（11/24）
// 決算の未払金・年度の人件費の見積もりに使う。月ごとに、保険料の一覧と同じ計算（月額と賞与を足してから
// 1円未満を切り捨てた納付額 − 本人負担の合計）で、納付書の行（健康保険〈介護・支援金を含む〉・厚生年金・拠出金）ごとの
// 会社負担を出し、期間で合計する。保険料の一覧の「事業所の合計」と1円もずれない。
// Angular・Firebase に依存しない純粋な関数

import type { OfficeTotal } from '../../../core/models/premium';
import { shiftMonth, YearMonth } from '../../../shared/utils/date';
import { buildPremiumRow, RowInput } from './premium-rows';
import { BonusContext, BonusEmployee, BonusPaymentLike, collectBonusResults } from './bonus-rows';
import { officeTotals } from './premium-core';

/** 選べる期間の長さの上限（月） */
export const PERIOD_MAX_MONTHS = 24;

export type TotalCategory = OfficeTotal['category'];
export const TOTAL_CATEGORIES: readonly TotalCategory[] = ['health', 'pension', 'childContribution'];

/** 1か月分（納付書の行ごと） */
export interface PeriodMonth {
  month: YearMonth;
  /** 会社負担（行ごと。月額と賞与を合わせた額） */
  employer: Record<TotalCategory, number>;
  employerTotal: number;
  /** 本人負担の合計・納付額（会社負担の目安を確かめるため） */
  employeeTotal: number;
  paymentTotal: number;
  /** この月に賞与の支給がある */
  hasBonus: boolean;
  /** 計算できなかった人（標準報酬が未登録など）の数。その人の分は入っていない */
  problems: number;
}

/** 'from'〜'to'（両端を含む）の月。逆順・長すぎるときは null */
export function monthsOfPeriod(from: YearMonth, to: YearMonth): YearMonth[] | null {
  if (from > to) return null;
  const out: YearMonth[] = [];
  for (let m = from; m <= to; m = shiftMonth(m, 1)) {
    out.push(m);
    if (out.length > PERIOD_MAX_MONTHS) return null;
  }
  return out;
}

/** 今年度の4月（1〜3月なら前の年の4月） */
export function fiscalStart(month: YearMonth): YearMonth {
  const y = Number(month.slice(0, 4));
  return Number(month.slice(5, 7)) >= 4 ? `${y}-04` : `${y - 1}-04`;
}

export interface PeriodInput<E extends BonusEmployee> {
  employees: readonly E[];
  /** 1人分の月額の計算に使うもの（月は中で入れる） */
  rowInputOf: (employee: E) => Omit<RowInput, 'month' | 'employee'>;
  payments: BonusPaymentLike[];
  bonusCtx: BonusContext;
}

/** 1か月分を出す（保険料の一覧と同じ関数で計算する） */
export function periodMonth<E extends BonusEmployee>(month: YearMonth, x: PeriodInput<E>): PeriodMonth {
  const monthly = [];
  let problems = 0;
  for (const employee of x.employees) {
    const row = buildPremiumRow({ month, employee, ...x.rowInputOf(employee) });
    if (row.state === 'ok' && row.result) monthly.push(row.result);
    else if (row.state === 'missing' || row.state === 'error') problems++;
  }
  const hasBonus = x.payments.some((p) => p.paidDate.startsWith(month));
  const bonus = hasBonus
    ? collectBonusResults([...x.employees], x.payments, x.bonusCtx, (d) => d.startsWith(month))
    : { results: [], problemCount: 0 };
  const totals = officeTotals([...monthly, ...bonus.results]);
  const of = (c: TotalCategory) => totals.find((t) => t.category === c);
  const employer = {
    health: of('health')?.employerYen ?? 0,
    pension: of('pension')?.employerYen ?? 0,
    childContribution: of('childContribution')?.employerYen ?? 0,
  };
  return {
    month,
    employer,
    employerTotal: employer.health + employer.pension + employer.childContribution,
    employeeTotal: totals.reduce((s, t) => s + t.employeeYen, 0),
    paymentTotal: totals.reduce((s, t) => s + t.totalYen, 0),
    hasBonus,
    problems: problems + bonus.problemCount,
  };
}

/** 期間の合計の行 */
export function sumPeriod(rows: readonly PeriodMonth[]): Omit<PeriodMonth, 'month' | 'hasBonus'> {
  const z = { health: 0, pension: 0, childContribution: 0 };
  for (const r of rows) for (const c of TOTAL_CATEGORIES) z[c] += r.employer[c];
  return {
    employer: z,
    employerTotal: rows.reduce((s, r) => s + r.employerTotal, 0),
    employeeTotal: rows.reduce((s, r) => s + r.employeeTotal, 0),
    paymentTotal: rows.reduce((s, r) => s + r.paymentTotal, 0),
    problems: rows.reduce((s, r) => s + r.problems, 0),
  };
}
