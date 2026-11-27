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
import { CoverageInput, coverageForMonth, pensionLostDate } from '../../employees/logic/coverage';
import { shiftMonth, toYearMonth, YearMonth } from '../../../shared/utils/date';
import { LeaveHolder } from '../../employees/logic/leave';
import { latest, RateTables } from '../../rates/logic/pick-rates';
import { calcMonthly, RemunerationLike } from './calc-monthly';
import { AdjustmentInput } from './premium-adjustment';
import { PremiumSplit, splitContribution } from './premium-core';
import { CategoryMilli, categoryMilliOf, ZERO_CATEGORY } from './diff-causes';

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
  /**
   * 厚生年金を同じ月に取得して喪失した（同月得喪。11/19）
   * その月の厚生年金保険料はかかるが、同じ月にほかで厚生年金・国民年金（第1号・第3号）に入ると、
   * 年金事務所から連絡があり、厚生年金保険料は納めなくてよくなる（健康保険・介護は対象外。2015年10月から）
   */
  sameMonthPension: boolean;
  /** 前の月の標準報酬と本人負担（標準報酬が変わる人の CSV で「前」に出す。11/26） */
  previous?: {
    health: StandardRemuneration | null;
    pension: StandardRemuneration | null;
    /** 前の月の本人負担の合計（計算できない・かからない月は null、免除の月は 0） */
    employeeYen: number | null;
    /** 前の月の全額を告知書の欄ごとに（かからない・免除・計算できない月は 0。告知額の差の原因を当てる。11/26） */
    categoryMilli: CategoryMilli;
  };
}

export interface RowInput {
  month: YearMonth;
  employee: CoverageInput & LeaveHolder;
  remunerations: RemunerationLike[];
  ratesFor: (month: YearMonth) => RatesForMonth;
  options: PremiumOptions;
  /** 保険料調整制度の軽減割合（月ごと。省くと軽減なし。11/16） */
  adjustmentFor?: (month: YearMonth) => AdjustmentInput | null;
  /** 月 → 特定被保険者として介護保険料をかけるか（組合健保。省くとかけない。11/26） */
  specialInsuredFor?: (month: YearMonth) => boolean;
  /** 料率の表（二以上事業所勤務で別の都道府県の協会けんぽを選んだ人。11/28） */
  tables?: RateTables;
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
      specialInsured: input.specialInsuredFor?.(month) ?? false,
      tables: input.tables,
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

/** 前の月の標準報酬（その月に加入していた保険だけ）と本人負担 */
function previousOf(input: RowInput, prev: { state: RowState; result: PremiumResult | null }): PremiumRow['previous'] {
  const month = shiftMonth(input.month, -1);
  const std = exemptStandards(input, month);
  const employeeYen = prev.state === 'ok' ? prev.result!.employeeYen : prev.state === 'exempt' ? 0 : null;
  const categoryMilli = prev.state === 'ok' ? categoryMilliOf(prev.result) : { ...ZERO_CATEGORY };
  return { health: std.health, pension: std.pension, employeeYen, categoryMilli };
}

/** 免除の月は保険料の行がないので、標準報酬月額は履歴から出す（その月に加入している保険だけ） */
function exemptStandards(input: RowInput, month: YearMonth = input.month) {
  const rem = latest(input.remunerations, month);
  const cov = coverageForMonth(input.employee, month);
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
    previous: previousOf(input, prev),
    lastMonth: cur.state === 'ok' && isLastMonthBeforeLeaving(input.employee, input.month),
    sameMonthPension: isSameMonthPension(input.employee, input.month),
  };
}

/** 喪失の原因（社員の文書にはあるが、加入の判定の型にはないので、ここで足して読む） */
type WithLossReason = { health: { lossReason?: string | null }; pension: { lossReason?: string | null }; retireReason?: string | null };

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
  // 事業所の間の異動（転勤）は、同じ会社で給与が続くので2か月分の控除にはならない（11/24）
  if (employee.retireReason === 'transfer') return false;
  const leaving = (r: string | null | undefined) => r == null || r === 'retire' || r === 'death';
  const reasons: (string | null | undefined)[] = [];
  if (cur.health) reasons.push(employee.health.lossReason);
  if (cur.pension) reasons.push(employee.pension.lossReason);
  return reasons.every(leaving);
}

/** 厚生年金を、その月に取得して同じ月に喪失したか（同月得喪） */
export function isSameMonthPension(employee: CoverageInput, month: YearMonth): boolean {
  const acquired = employee.pension.acquiredDate;
  const lost = pensionLostDate(employee);
  return !!acquired && !!lost && toYearMonth(acquired) === month && toYearMonth(lost) === month && lost > acquired;
}

/** その月から一斉改定の行が効いていれば、「等級変更」を「上限の改定」に言いかえる */
function capChanges(input: RowInput, changes: ChangeReason[]): ChangeReason[] {
  const rem = latest(input.remunerations, input.month);
  if (!rem?.capRevised || rem.from !== input.month) return changes;
  return changes.map((c) => (c === 'grade' ? 'cap' : c));
}
