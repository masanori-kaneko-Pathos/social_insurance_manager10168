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
import { CoverageInput, coverageForMonth } from '../../employees/logic/coverage';
import { shiftMonth, YearMonth } from '../../../shared/utils/date';
import { LeaveHolder } from '../../employees/logic/leave';
import { latest } from '../../rates/logic/pick-rates';
import { calcMonthly, RemunerationLike } from './calc-monthly';
import { AdjustmentInput } from './premium-adjustment';
import { PremiumSplit, splitContribution } from './premium-core';

export type RowState = 'ok' | 'none' | 'missing' | 'error' | 'exempt';

/** 前の月から変わった理由 */
/** careStart・careEnd：介護分が始まった（40歳）・終わった（65歳・適用除外）月。前は 'care' 1つで、始まりか終わりか分からなかった（11/16） */
/** cap：等級の上限が上がったときの、届出なしの一斉改定（11/16） */
export type ChangeReason = 'new' | 'grade' | 'cap' | 'careStart' | 'careEnd' | 'rate' | 'other';

export interface PremiumRow extends PremiumSplit {
  state: RowState;
  result: PremiumResult | null;
  health: StandardRemuneration | null; // その月の健保の等級・標準報酬月額
  pension: StandardRemuneration | null; // その月の厚年の等級・標準報酬月額
  care: boolean; // 介護保険料がかかっているか
  healthEmployeeYen: number; // 本人負担のうち 健保・介護・支援金
  pensionEmployeeYen: number; // 本人負担のうち 厚年
  changes: ChangeReason[];
  /** 退職・死亡で資格を失う前の最後の月（最後の給与から前月分とこの月分を控除できる。健保法167条1項。11/19） */
  lastMonth: boolean;
}

export interface RowInput {
  month: YearMonth;
  employee: CoverageInput & LeaveHolder;
  remunerations: RemunerationLike[];
  ratesFor: (month: YearMonth) => RatesForMonth;
  options: PremiumOptions;
  /** 保険料調整制度の軽減割合（月ごと。省くと軽減なし。11/16） */
  adjustmentFor?: (month: YearMonth) => AdjustmentInput | null;
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
      adjustment: input.adjustmentFor?.(month) ?? null,
    });
    if (result.exempt) return { state: 'exempt', result };
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
      if (part === 'care') reasons.add(b ? 'careStart' : 'careEnd');
      else reasons.add(part === 'childSupport' ? 'rate' : 'other');
    } else {
      if (a.base !== b.base || a.grade !== b.grade) reasons.add('grade');
      if (a.rate.from !== b.rate.from) reasons.add('rate');
    }
  }
  if (reasons.size === 0 && prev.result!.employeeYen !== cur.result!.employeeYen)
    reasons.add('other');
  return [...reasons];
}

/** 免除の月は保険料の行がないので、標準報酬月額は履歴から出す（その月に加入している保険だけ） */
function exemptStandards(input: RowInput) {
  const rem = latest(input.remunerations, input.month);
  const cov = coverageForMonth(input.employee, input.month);
  return {
    health: cov.health ? (rem?.health ?? null) : null,
    pension: cov.pension ? (rem?.pension ?? null) : null,
  };
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

  const exemptStd = cur.state === 'exempt' ? exemptStandards(input) : null;

  return {
    ...split,
    state: cur.state,
    result: cur.result,
    health:
      exemptStd?.health ??
      (health?.grade != null ? { grade: health.grade, standard: health.base } : null),
    pension:
      exemptStd?.pension ??
      (pension?.grade != null ? { grade: pension.grade, standard: pension.base } : null),
    care: lines.has('care'),
    healthEmployeeYen: groups
      .filter((g) => g.parts.some((p) => HEALTH_PARTS.includes(p)))
      .reduce((s, g) => s + g.employeeYen, 0),
    pensionEmployeeYen: groups
      .filter((g) => g.parts.includes('pension'))
      .reduce((s, g) => s + g.employeeYen, 0),
    changes: capChanges(input, changesBetween(prev, cur)),
    lastMonth: cur.state === 'ok' && isLastMonthBeforeLeaving(input.employee, input.month),
  };
}

/** 喪失の原因（社員の文書にはあるが、加入の判定の型にはないので、ここで足して読む） */
type WithLossReason = { health: { lossReason?: string | null }; pension: { lossReason?: string | null } };

/**
 * 使用されなくなった（退職・死亡）ために、この月が保険料のかかる最後の月か（11/19）
 * - この月は健保か厚年がかかり、次の月はどちらもかからない
 * - 喪失の原因が 退職・死亡（原因が空の古いデータは退職とみなす）。75歳・障害認定・任意喪失などは除く
 * 保険料は翌月控除なので、この月分はふつう翌月の給与から控除する。翌月に給与がないときは、
 * 最後の給与から前月分とこの月分の2か月分を控除できる（健康保険法167条1項・厚生年金保険法84条1項）
 */
export function isLastMonthBeforeLeaving(
  employee: CoverageInput & Partial<WithLossReason>,
  month: YearMonth,
): boolean {
  const cur = coverageForMonth(employee, month);
  const next = coverageForMonth(employee, shiftMonth(month, 1));
  if (!(cur.health || cur.pension) || next.health || next.pension) return false;
  const leaving = (r: string | null | undefined) => r == null || r === 'retire' || r === 'death';
  const reasons: (string | null | undefined)[] = [];
  if (cur.health) reasons.push(employee.health.lossReason);
  if (cur.pension) reasons.push(employee.pension.lossReason);
  return reasons.every(leaving);
}

/** その月から一斉改定の行が効いていれば、「等級変更」を「上限の改定」に言いかえる */
function capChanges(input: RowInput, changes: ChangeReason[]): ChangeReason[] {
  const rem = latest(input.remunerations, input.month);
  if (!rem?.capRevised || rem.from !== input.month) return changes;
  return changes.map((c) => (c === 'grade' ? 'cap' : c));
}
