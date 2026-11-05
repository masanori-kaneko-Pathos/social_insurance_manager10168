/**
 * 賞与の画面・一覧・保険料一覧に出す行と合計を作る（calc-bonus を全員分に広げる層）
 * 健保の年度累計（573万円）・厚年の同じ月の合計（150万円）は、ほかの支給の分も入れて計算する。
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 */
import {
  BonusPremiumResult,
  OfficeTotal,
  PremiumOptions,
  PremiumPart,
} from '../../../core/models/premium';
import { RatesForMonth } from '../../../core/models/rates';
import {
  CoverageInput,
  DateStr,
  healthLostDate,
  pensionLostDate,
  YearMonth,
} from '../../employees/logic/coverage';
import { BonusPayment, bonusStatus, calcBonuses } from './calc-bonus';
import { PremiumSplit, splitContribution } from './premium-core';
import { LeaveHolder } from '../../employees/logic/leave';

/** 計算に使う支給の形（BonusPaymentDoc をそのまま渡せる） */
export interface BonusPaymentLike {
  id: string;
  paidDate: DateStr;
  amounts: Record<string, number>;
}

export type BonusEmployee = CoverageInput & LeaveHolder & { id: string };

export interface BonusContext {
  ratesFor: (month: YearMonth) => RatesForMonth;
  options: PremiumOptions;
}

const HEALTH_PARTS: PremiumPart[] = ['health', 'care', 'childSupport'];

/** その従業員の賞与（全支給から。0円・空は払っていない扱い） */
export function bonusesOf(employeeId: string, payments: BonusPaymentLike[]): BonusPayment[] {
  const list: BonusPayment[] = [];
  for (const p of payments) {
    const amount = p.amounts[employeeId];
    if (amount && amount > 0) list.push({ paidDate: p.paidDate, amount });
  }
  return list;
}

/** 保存済みの支給のうち、入力中の支給（同じ id）だけを入力中の内容に差し替える */
export function withDraft(
  payments: BonusPaymentLike[],
  draft: BonusPaymentLike,
): BonusPaymentLike[] {
  return [...payments.filter((p) => p.id !== draft.id), draft];
}

/** 支払日に賞与の対象になりうるか（健保は喪失月も「累計に入る」ので対象として表に出す） */
export function eligibleOn(employee: CoverageInput, paidDate: DateStr): boolean {
  const health = bonusStatus(
    employee.health.enrolled,
    employee.health.acquiredDate,
    healthLostDate(employee),
    paidDate,
  );
  const pension = bonusStatus(
    employee.pension.enrolled,
    employee.pension.acquiredDate,
    pensionLostDate(employee),
    paidDate,
  );
  return health !== 'none' || pension === 'charged';
}

/** 1人分の全賞与を計算（データがおかしくて計算できないときは error） */
function calcFor(
  employee: BonusEmployee,
  payments: BonusPaymentLike[],
  ctx: BonusContext,
): { results: BonusPremiumResult[]; error: boolean } {
  const bonuses = bonusesOf(employee.id, payments);
  if (bonuses.length === 0) return { results: [], error: false };
  try {
    return {
      results: calcBonuses({ employee, bonuses, ratesFor: ctx.ratesFor, options: ctx.options }),
      error: false,
    };
  } catch (err) {
    console.error(err);
    return { results: [], error: true };
  }
}

/**
 * 行の状態
 * ok：保険料がかかる／empty：この支給で賞与なし／none：支払日に資格がない
 * counted：喪失月（保険料はかからないが健保の累計には入る）／missing：料率がない／error：計算できない
 */
export type BonusRowState = 'ok' | 'empty' | 'none' | 'counted' | 'exempt' | 'missing' | 'error';

export interface BonusRow extends PremiumSplit {
  state: BonusRowState;
  result: BonusPremiumResult | null;
  healthEmployeeYen: number; // 本人負担のうち 健保・介護・支援金
  pensionEmployeeYen: number; // 本人負担のうち 厚年
  capped: boolean; // 上限で削られたか
}

const EMPTY_SPLIT: PremiumSplit = {
  premiumTotalMilli: 0,
  premiumEmployerMilli: 0,
  contributionMilli: 0,
};

function stateOf(r: BonusPremiumResult | null): BonusRowState {
  if (!r) return 'empty';
  if (r.exempt) return 'exempt';
  if (r.missing.length > 0) return 'missing';
  if (r.groups.length > 0) return 'ok';
  return r.healthStatus === 'counted' ? 'counted' : 'none';
}

function isCapped(r: BonusPremiumResult): boolean {
  return (
    (r.healthStatus !== 'none' && r.healthBase < r.standardBonus) ||
    (r.pensionStatus === 'charged' && r.pensionBase < r.standardBonus)
  );
}

/** ある支払日の支給について、1人分の行 */
export function buildBonusRow(
  employee: BonusEmployee,
  payments: BonusPaymentLike[],
  paidDate: DateStr,
  ctx: BonusContext,
): BonusRow {
  const { results, error } = calcFor(employee, payments, ctx);
  const result = results.find((r) => r.paidDate === paidDate) ?? null;
  const groups = result?.groups ?? [];
  return {
    ...(result ? splitContribution(result) : EMPTY_SPLIT),
    state: error ? 'error' : stateOf(result),
    result,
    healthEmployeeYen: groups
      .filter((g) => g.parts.some((p) => HEALTH_PARTS.includes(p)))
      .reduce((s, g) => s + g.employeeYen, 0),
    pensionEmployeeYen: groups
      .filter((g) => g.parts.includes('pension'))
      .reduce((s, g) => s + g.employeeYen, 0),
    capped: !!result && isCapped(result),
  };
}

/**
 * 支払日が pick に合う賞与の結果を、全員分集める（事業所の合計を出すため）
 * 計算できなかった人（料率がない・データがおかしい）は数だけ返し、結果には入れない
 */
export function collectBonusResults(
  employees: BonusEmployee[],
  payments: BonusPaymentLike[],
  ctx: BonusContext,
  pick: (paidDate: DateStr) => boolean,
): { results: BonusPremiumResult[]; problemCount: number } {
  const results: BonusPremiumResult[] = [];
  let problemCount = 0;
  for (const e of employees) {
    const hasAny = payments.some((p) => pick(p.paidDate) && (p.amounts[e.id] ?? 0) > 0);
    if (!hasAny) continue;
    const calc = calcFor(e, payments, ctx);
    if (calc.error) {
      problemCount++;
      continue;
    }
    for (const r of calc.results) {
      if (!pick(r.paidDate)) continue;
      if (r.missing.length > 0) problemCount++;
      else results.push(r);
    }
  }
  return { results, problemCount };
}

/** 事業所の合計を足し合わせる（月額 ＋ 賞与。どちらも端数処理した後の額を足す） */
export function addTotals(a: OfficeTotal[], b: OfficeTotal[]): OfficeTotal[] {
  const byCat = new Map(b.map((t) => [t.category, t]));
  return a.map((t) => {
    const o = byCat.get(t.category);
    return o
      ? {
          category: t.category,
          totalYen: t.totalYen + o.totalYen,
          employeeYen: t.employeeYen + o.employeeYen,
          employerYen: t.employerYen + o.employerYen,
        }
      : t;
  });
}
