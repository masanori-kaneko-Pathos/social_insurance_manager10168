/**
 * 賞与の保険料の計算
 * - 標準賞与額 ＝ 賞与額の1,000円未満を切り捨て
 * - 保険料がかかるかは「月」ではなく「支払日」で判定する
 *   ・資格取得日より前に払った賞与：かからない（取得月でも）
 *   ・資格喪失月に払った賞与：かからない。ただし健保は標準賞与額が決まり、年度の累計には入る
 *   ・同月得喪：資格取得日〜資格喪失日の前日に払った賞与はかかる
 *   ・資格喪失日以降に払った賞与：かからない（累計にも入らない）
 *   70歳（厚年）・75歳（健保）で資格を失う月も同じ扱い
 * - 上限：健保・介護・支援金は年度（4月〜翌3月）の累計573万円（平成27年度までは540万円）、厚年・拠出金は同じ月の合計150万円
 * - 保険者が変わったら（協会けんぽ ⇔ 組合など）、健保の年度の累計は新しい保険者で数え直す（11/17）
 * - 転職した人：同じ年度・同じ保険者の前の事業所の標準賞与額（本人の累計申出で保険者から知らされた額）も、健保の累計に入れる（11/16）
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
import { CoverageInput, healthLostDate, isCareMonth, pensionLostDate } from '../../employees/logic/coverage';
import { DateStr, fiscalYearOf, toYearMonth } from '../../../shared/utils/date';
import { makeGroups, makeLine, withTotals } from './premium-core';
import { exemptBonus, filedLeaves, LeaveHolder } from '../../employees/logic/leave';

export const HEALTH_BONUS_CAP_PER_YEAR = 5_730_000; // 健保：年度の累計（平成28年度から）
/** 平成27年度までの健保の年度の上限（平成28年4月に540万円→573万円。過去の料率を入れたので年度で分ける。11/16） */
export const HEALTH_BONUS_CAP_PER_YEAR_BEFORE_2016 = 5_400_000;

/** その年度（4月始まり）の健保の標準賞与額の上限 */
export function healthBonusCapOf(fiscalYear: number): number {
  return fiscalYear >= 2016 ? HEALTH_BONUS_CAP_PER_YEAR : HEALTH_BONUS_CAP_PER_YEAR_BEFORE_2016;
}
export const PENSION_BONUS_CAP_PER_MONTH = 1_500_000; // 厚年：同じ月の合計

export interface EmployeeBonus {
  paidDate: DateStr; // 'YYYY-MM-DD'
  amount: number; // 賞与額（円）
}

/** 前の事業所の健保の標準賞与額の累計（年度 'YYYY' → 円）を持つ人 */
export interface PriorBonusHolder {
  priorBonusTotals?: Record<string, number> | null;
}

/** その年度の、前の事業所の分（なければ 0） */
export function priorHealthOf(e: PriorBonusHolder, fiscalYear: number): number {
  const v = e.priorBonusTotals?.[String(fiscalYear)];
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : 0;
}

export interface BonusInput {
  employee: CoverageInput & LeaveHolder & PriorBonusHolder;
  /** その従業員の賞与（年度の累計を出すため、同じ年度の分は全部渡す） */
  bonuses: EmployeeBonus[];
  /** 月 → その月の料率（pickRates を包んだ関数） */
  ratesFor: (month: string) => RatesForMonth;
  /** 月 → 保険者の鍵（insurerKeyOf）。なければ保険者は変わらない扱い */
  insurerOf?: (month: string) => string;
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

  const healthCumByYear = new Map<string, number>(); // 年度|保険者 → 健保の標準賞与額の累計
  const priorKeyOf = new Map<number, string>(); // 年度 → 前の事業所の分を足した保険者の鍵（その年度の最初の保険者にだけ足す）
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
    // 免除は申出をした休業だけ。申出がまだなら保険料をかけ、exemptPending で知らせる（健保法159条・159条の3。11/19）
    const charged = rawHealth === 'charged' || rawPensionCharged;
    const exempt = charged && exemptBonus(filedLeaves(employee.leaves), b.paidDate);
    const exemptPending = charged && !exempt && exemptBonus(employee.leaves, b.paidDate);
    const healthStatus = exempt && rawHealth === 'charged' ? 'counted' : rawHealth;
    const pensionStatus: 'charged' | 'none' = rawPensionCharged && !exempt ? 'charged' : 'none';

    // 健保：年度の累計573万円（喪失月の賞与も累計には入る）
    let healthBase = 0;
    const year = fiscalYearOf(month);
    const key = `${year}|${input.insurerOf?.(month) ?? ''}`;
    if (healthStatus !== 'none') {
      let before = healthCumByYear.get(key);
      if (before === undefined) {
        before = priorKeyOf.has(year) ? 0 : priorHealthOf(employee, year);
        if (!priorKeyOf.has(year)) priorKeyOf.set(year, key);
      }
      healthBase = Math.min(standardBonus, Math.max(0, healthBonusCapOf(year) - before));
      healthCumByYear.set(key, before + standardBonus);
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
      if (isCareMonth(employee, month)) add('care', healthBase, rates.care); // 適用除外の月は除く
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
      ...(exemptPending ? { exemptPending: true } : {}),
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
      // 前の事業所の分（この賞与の保険者の累計に足したときだけ）
      priorHealth: (priorKeyOf.get(year) ?? key) === key ? priorHealthOf(employee, year) : 0,
    };
  });
}
