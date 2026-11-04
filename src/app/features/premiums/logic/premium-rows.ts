/**
 * 保険料一覧の1行分（1人・1か月）を作る
 * 前の月の計算と比べて、変わった理由（等級・介護・料率など）も付ける。
 */
import {
  PremiumLine,
  PremiumOptions,
  PremiumPart,
  PremiumResult,
} from '../../../core/models/premium';
import { RatesForMonth } from '../../../core/models/rates';
import { StandardRemuneration } from '../../../core/models/remuneration';
import { CoverageInput, shiftMonth, YearMonth } from '../../employees/logic/coverage';
import { calcMonthly, RemunerationLike } from './calc-monthly';
import { PremiumSplit, splitContribution } from './premium-core';

export type RowState = 'ok' | 'none' | 'missing' | 'error';

/** 前の月から変わった理由 */
export type ChangeReason = 'new' | 'grade' | 'care' | 'rate' | 'other';

export interface PremiumRow extends PremiumSplit {
  state: RowState;
  result: PremiumResult | null;
  health: StandardRemuneration | null; // その月の健保の等級・標準報酬月額
  pension: StandardRemuneration | null; // その月の厚年の等級・標準報酬月額
  care: boolean; // 介護保険料がかかっているか
  healthEmployeeYen: number; // 本人負担のうち 健保・介護・支援金
  pensionEmployeeYen: number; // 本人負担のうち 厚年
  changes: ChangeReason[];
}

export interface RowInput {
  month: YearMonth;
  employee: CoverageInput;
  remunerations: RemunerationLike[];
  ratesFor: (month: YearMonth) => RatesForMonth;
  options: PremiumOptions;
}

const HEALTH_PARTS: PremiumPart[] = ['health', 'care', 'childSupport'];

function calcSafe(
  input: RowInput,
  month: YearMonth,
): { state: RowState; result: PremiumResult | null } {
  try {
    const result = calcMonthly({
      month,
      employee: input.employee,
      remunerations: input.remunerations,
      rates: input.ratesFor(month),
      options: input.options,
    });
    if (result.missing.length > 0) return { state: 'missing', result };
    if (result.groups.length === 0) return { state: 'none', result };
    return { state: 'ok', result };
  } catch (err) {
    console.error(err);
    return { state: 'error', result: null };
  }
}

function linesOf(result: PremiumResult | null): Map<PremiumPart, PremiumLine> {
  const map = new Map<PremiumPart, PremiumLine>();
  for (const g of result?.groups ?? []) for (const l of g.lines) map.set(l.part, l);
  return map;
}

/** 前の月と比べて、変わった理由を出す（比べられないときは空） */
export function changesBetween(
  prev: { state: RowState; result: PremiumResult | null },
  cur: { state: RowState; result: PremiumResult | null },
): ChangeReason[] {
  if (cur.state !== 'ok') return [];
  if (prev.state === 'none') return ['new'];
  if (prev.state !== 'ok') return [];

  const before = linesOf(prev.result);
  const after = linesOf(cur.result);
  const reasons = new Set<ChangeReason>();

  for (const part of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(part);
    const b = after.get(part);
    if (!a || !b) {
      // 保険料の種類が増えた・減った
      reasons.add(part === 'care' ? 'care' : part === 'childSupport' ? 'rate' : 'other');
    } else {
      if (a.base !== b.base || a.grade !== b.grade) reasons.add('grade');
      if (a.rate.from !== b.rate.from) reasons.add('rate');
    }
  }
  if (reasons.size === 0 && prev.result!.employeeYen !== cur.result!.employeeYen)
    reasons.add('other');
  return [...reasons];
}

export function buildPremiumRow(input: RowInput): PremiumRow {
  const cur = calcSafe(input, input.month);
  const prev = calcSafe(input, shiftMonth(input.month, -1));
  const lines = linesOf(cur.result);
  const health = lines.get('health');
  const pension = lines.get('pension');
  const groups = cur.result?.groups ?? [];
  const split = cur.result
    ? splitContribution(cur.result)
    : { premiumTotalMilli: 0, premiumEmployerMilli: 0, contributionMilli: 0 };

  return {
    ...split,
    state: cur.state,
    result: cur.result,
    health: health?.grade != null ? { grade: health.grade, standard: health.base } : null,
    pension: pension?.grade != null ? { grade: pension.grade, standard: pension.base } : null,
    care: lines.has('care'),
    healthEmployeeYen: groups
      .filter((g) => g.parts.some((p) => HEALTH_PARTS.includes(p)))
      .reduce((s, g) => s + g.employeeYen, 0),
    pensionEmployeeYen: groups
      .filter((g) => g.parts.includes('pension'))
      .reduce((s, g) => s + g.employeeYen, 0),
    changes: changesBetween(prev, cur),
  };
}
