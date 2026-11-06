/**
 * 賞与の保険料の計算
 * - 標準賞与額 ＝ 賞与額の1,000円未満を切り捨て
 * - 保険料がかかるかは「月」ではなく「支払日」で判定する
 *   ・資格取得日より前に払った賞与：かからない（取得月でも）
 *   ・資格喪失月に払った賞与：かからない。ただし健保は標準賞与額が決まり、年度の累計には入る
 *   ・同月得喪：資格取得日〜資格喪失日の前日に払った賞与はかかる
 *   ・資格喪失日以降に払った賞与：かからない（累計にも入らない）
 *   70歳（厚年）・75歳（健保）で資格を失う月も同じ扱い
 * - 上限：健保・介護・支援金は年度（4月〜翌3月）の累計573万円、厚年・拠出金は同じ月の合計150万円
 * 未対応：育休・産休中の賞与の免除（休業のデータができてから）
 */
import {
  BonusPremiumResult,
  DEFAULT_PREMIUM_OPTIONS,
  MissingReason,
  PremiumLine,
  PremiumOptions,
  PremiumPart,
} from '../../../core/models/premium';
import { PickedRate, RatesForMonth } from '../../../core/models/rates';
import { ageReachDate, CoverageInput, healthLostDate, pensionLostDate } from '../../employees/logic/coverage';
import { DateStr, fiscalYearOf, toYearMonth } from '../../../shared/utils/date';
import { makeGroups, makeLine, withTotals } from './premium-core';
import { exemptBonus, LeaveHolder } from '../../employees/logic/leave';

export const HEALTH_BONUS_CAP_PER_YEAR = 5_730_000; // 健保：年度の累計
export const PENSION_BONUS_CAP_PER_MONTH = 1_500_000; // 厚年：同じ月の合計

export interface BonusPayment {
  paidDate: DateStr; // 'YYYY-MM-DD'
  amount: number; // 賞与額（円）
}

export interface BonusInput {
  employee: CoverageInput & LeaveHolder;
  /** その従業員の賞与（年度の累計を出すため、同じ年度の分は全部渡す） */
  bonuses: BonusPayment[];
  /** 月 → その月の料率（pickRates を包んだ関数） */
  ratesFor: (month: string) => RatesForMonth;
  options?: PremiumOptions;
}

/** 標準賞与額（1,000円未満を切り捨て） */
export function standardBonusOf(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new Error(`賞与額が正しくありません: ${amount}`);
  return amount - (amount % 1000);
}

/**
 * 支払日から、その賞与が保険料の対象かを判定する
 * charged：保険料がかかる／counted：かからないが標準賞与額は決まる（喪失月）／none：対象外
 */
export function bonusStatus(
  enrolled: boolean,
  acquiredDate: DateStr | null,
  lostDate: DateStr | null,
  paidDate: DateStr,
): 'charged' | 'counted' | 'none' {
  if (!enrolled || !acquiredDate) return 'none';
  if (paidDate < acquiredDate) return 'none';
  if (lostDate && paidDate >= lostDate) return 'none';
  const lostMonth = lostDate ? toYearMonth(lostDate) : null;
  const sameMonthInOut = lostMonth === toYearMonth(acquiredDate); // 同月得喪
  if (lostMonth === toYearMonth(paidDate) && !sameMonthInOut) return 'counted';
  return 'charged';
}

export function calcBonuses(input: BonusInput): BonusPremiumResult[] {
  const { employee } = input;
  const options = input.options ?? DEFAULT_PREMIUM_OPTIONS;
  const healthLost = healthLostDate(employee);
  const pensionLost = pensionLostDate(employee);
  const careStart = toYearMonth(ageReachDate(employee.birthDate, 40));
  const careEnd = toYearMonth(ageReachDate(employee.birthDate, 65));

  const healthCumByYear = new Map<number, number>(); // 年度 → 健保の標準賞与額の累計
  const pensionSumByMonth = new Map<string, number>(); // 月 → 厚年の標準賞与額の合計

  // 支払日の順に計算する（上限は先に払った賞与から順に埋まる）
  const sorted = [...input.bonuses].sort((a, b) => a.paidDate.localeCompare(b.paidDate));

  return sorted.map((b) => {
    const month = toYearMonth(b.paidDate);
    const standardBonus = standardBonusOf(b.amount);
    const rawHealth = bonusStatus(
      employee.health.enrolled,
      employee.health.acquiredDate,
      healthLost,
      b.paidDate,
    );
    const rawPensionCharged =
      bonusStatus(
        employee.pension.enrolled,
        employee.pension.acquiredDate,
        pensionLost,
        b.paidDate,
      ) === 'charged';
    // 産休・育休で免除：保険料はかからないが、健保は標準賞与額が決まり年度累計に入る（日本年金機構）
    const exempt =
      (rawHealth === 'charged' || rawPensionCharged) && exemptBonus(employee.leaves, b.paidDate);
    const healthStatus = exempt && rawHealth === 'charged' ? 'counted' : rawHealth;
    const pensionStatus: 'charged' | 'none' = rawPensionCharged && !exempt ? 'charged' : 'none';

    // 健保：年度の累計573万円（喪失月の賞与も累計には入る）
    let healthBase = 0;
    if (healthStatus !== 'none') {
      const year = fiscalYearOf(month);
      const before = healthCumByYear.get(year) ?? 0;
      healthBase = Math.min(standardBonus, Math.max(0, HEALTH_BONUS_CAP_PER_YEAR - before));
      healthCumByYear.set(year, before + standardBonus);
    }

    // 厚年：同じ月の合計150万円
    let pensionBase = 0;
    if (pensionStatus === 'charged') {
      const before = pensionSumByMonth.get(month) ?? 0;
      pensionBase = Math.min(standardBonus, Math.max(0, PENSION_BONUS_CAP_PER_MONTH - before));
      pensionSumByMonth.set(month, before + standardBonus);
    }

    const rates = input.ratesFor(month);
    const lines: PremiumLine[] = [];
    const missing: { part: PremiumPart; reason: MissingReason }[] = [];
    const add = (part: PremiumPart, base: number, rate: PickedRate | null) => {
      if (!rate) missing.push({ part, reason: 'noRate' });
      else if (rate.employee + rate.employer > 0) lines.push(makeLine(part, base, null, rate));
    };

    if (healthStatus === 'charged') {
      add('health', healthBase, rates.health);
      if (month >= careStart && month < careEnd) add('care', healthBase, rates.care);
      add('childSupport', healthBase, rates.childSupport);
    }
    if (pensionStatus === 'charged') {
      add('pension', pensionBase, rates.pension);
      add('childContribution', pensionBase, rates.childContribution);
    }

    const result = withTotals({
      kind: 'bonus',
      month,
      groups: makeGroups(lines, options),
      missing,
    });
    return {
      ...result,
      paidDate: b.paidDate,
      amount: b.amount,
      standardBonus,
      healthBase,
      pensionBase,
      healthStatus,
      pensionStatus,
      exempt,
    };
  });
}
