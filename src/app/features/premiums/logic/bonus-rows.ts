/**
 * 賞与の画面・一覧・保険料一覧に出す行と合計を作る（calc-bonus を全員分に広げる層）
 * 健保の年度累計（573万円）・厚年の同じ月の合計（150万円）は、ほかの支給の分も入れて計算する。
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 */
import {
  BonusPremiumResult,
  PremiumOptions,
  PremiumPart,
} from '../../../core/models/premium';
import { RatesForMonth } from '../../../core/models/rates';
import { CoverageInput, healthLostDate, isOver70Employee, pensionLostDate } from '../../employees/logic/coverage';
import { DateStr, YearMonth } from '../../../shared/utils/date';
import { EmployeeBonus, bonusStatus, calcBonuses, PriorBonusHolder } from './calc-bonus';
import { PremiumSplit, splitContribution } from './premium-core';
import { LeaveHolder } from '../../employees/logic/leave';
import { bonusTotalOf, countOf, isNotCovered, isRemunerationBonus, NaturePaymentLike, natureOf, periodYearOf } from './bonus-nature';

/** 計算に使う支給の形（BonusPayment をそのまま渡せる。性質・数え方は年4回以上の判定に使う。11/19） */
export type BonusPaymentLike = NaturePaymentLike;

export type BonusEmployee = CoverageInput & LeaveHolder & PriorBonusHolder & { id: string };

export interface BonusContext {
  ratesFor: (month: YearMonth) => RatesForMonth;
  insurerOf?: (month: YearMonth) => string;
  options: PremiumOptions;
  /** 従業員ID → 「月 → 特定被保険者か」（組合健保。省くとかけない。11/26） */
  specialInsuredOf?: (employeeId: string) => ((month: YearMonth) => boolean) | undefined;
}

const HEALTH_PARTS: PremiumPart[] = ['health', 'care', 'childSupport'];

/**
 * その従業員の賞与（全支給から。0円・空は払っていない扱い）
 * 「賞与に係る報酬」に当たる支給（年4回以上）は賞与ではないので外す（保険料も年度の累計も対象外。11/19）
 */
export function bonusesOf(employeeId: string, payments: BonusPaymentLike[]): EmployeeBonus[] {
  const list: EmployeeBonus[] = [];
  for (const p of payments) {
    // 通貨＋現物（現物の賞与も標準賞与額に入る。11/20）
    const amount = bonusTotalOf(p, employeeId);
    if (amount > 0 && !isNotCovered(p) && !isRemunerationBonus(employeeId, p, payments))
      list.push({ paidDate: p.paidDate, amount });
  }
  return list;
}

/** その人のその支給が「賞与に係る報酬」なら、性質と回数（7/1前1年）。賞与なら null（11/19） */
export function remunerationOf(
  employeeId: string,
  payment: BonusPaymentLike,
  payments: BonusPaymentLike[],
): { nature: string; count: number; year: number } | null {
  if (!isRemunerationBonus(employeeId, payment, payments)) return null;
  const year = periodYearOf(payment.paidDate);
  const nature = natureOf(payment);
  return { nature, count: countOf(employeeId, nature, year, payments), year };
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
      results: calcBonuses({
        employee,
        bonuses,
        ratesFor: ctx.ratesFor,
        insurerOf: ctx.insurerOf,
        options: ctx.options,
        specialInsuredAt: ctx.specialInsuredOf?.(employee.id),
      }),
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
 * remuneration：年4回以上の「賞与に係る報酬」（賞与の保険料・賞与支払届の対象外。定時決定で報酬月額に足す。11/19）
 * notCovered：賞与の項目で「社会保険の対象外」にした支給（祝い金など。11/19）
 */
export type BonusRowState = 'ok' | 'empty' | 'none' | 'counted' | 'exempt' | 'remuneration' | 'notCovered' | 'missing' | 'error';

export interface BonusRow extends PremiumSplit {
  state: BonusRowState;
  result: BonusPremiumResult | null;
  healthEmployeeYen: number; // 本人負担のうち 健保・介護・支援金
  pensionEmployeeYen: number; // 本人負担のうち 厚年
  capped: boolean; // 上限で削られたか
  /** 賞与に係る報酬のとき：性質と、7/1前1年に受けた回数（11/19） */
  remuneration: { nature: string; count: number; year: number } | null;
  /** 保険料はかからないが、70歳以上被用者として賞与支払届を出す人（75歳以上を含む。11/19） */
  over70: boolean;
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
  const payment = payments.find((p) => p.paidDate === paidDate);
  const remuneration = payment ? remunerationOf(employee.id, payment, payments) : null;
  const { results, error } = calcFor(employee, payments, ctx);
  const result = remuneration ? null : (results.find((r) => r.paidDate === paidDate) ?? null);
  const groups = result?.groups ?? [];
  return {
    ...(result ? splitContribution(result) : EMPTY_SPLIT),
    state:
      payment && bonusTotalOf(payment, employee.id) > 0 && isNotCovered(payment)
        ? 'notCovered'
        : remuneration
          ? 'remuneration'
          : error
            ? 'error'
            : stateOf(result),
    remuneration,
    over70: isOver70Employee(employee as BonusEmployee & { retireDate?: DateStr | null }, paidDate),
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
    const hasAny = payments.some((p) => pick(p.paidDate) && bonusTotalOf(p, e.id) > 0);
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

/**
 * 支払日が pick に合う賞与の結果を、人ごとに（保険料一覧の内訳で「この賞与の保険料はだれの分か」を見せる。11/19）
 * 計算できない人・料率がない人は入れない（事業所の合計と同じ）
 */
export function bonusResultsByEmployee(
  employees: BonusEmployee[],
  payments: BonusPaymentLike[],
  ctx: BonusContext,
  pick: (paidDate: DateStr) => boolean,
): Map<string, BonusPremiumResult[]> {
  const map = new Map<string, BonusPremiumResult[]>();
  for (const e of employees) {
    if (!payments.some((p) => pick(p.paidDate) && bonusTotalOf(p, e.id) > 0)) continue;
    const calc = calcFor(e, payments, ctx);
    if (calc.error) continue;
    const list = calc.results.filter((r) => pick(r.paidDate) && r.missing.length === 0);
    if (list.length > 0) map.set(e.id, list);
  }
  return map;
}
