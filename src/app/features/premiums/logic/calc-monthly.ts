/**
 * 1か月分の保険料の計算
 * 1. その月に加入しているか（coverage.ts）
 * 2. その月の標準報酬月額（報酬の履歴から一番新しいもの）
 * 3. その月の料率（pickRates の結果を受け取る）
 * 4. 計算して、端数処理の単位にまとめる
 * 材料が欠けているときは 0円 にせず、missing に理由を入れて返す。
 */
import {
  DEFAULT_PREMIUM_OPTIONS,
  MissingReason,
  PremiumLine,
  PremiumOptions,
  PremiumPart,
  PremiumResult,
} from '../../../core/models/premium';
import { PickedRate, RatesForMonth } from '../../../core/models/rates';
import { StandardRemuneration } from '../../../core/models/remuneration';
import { CoverageInput, coverageForMonth } from '../../employees/logic/coverage';
import { latest } from '../../rates/logic/pick-rates';
import { makeGroups, makeLine, withTotals } from './premium-core';

/** 報酬の履歴のうち、計算に使う部分（RemunerationDoc をそのまま渡せる） */
export interface RemunerationLike {
  from: string;
  health: StandardRemuneration;
  pension: StandardRemuneration;
}

export interface MonthlyInput {
  month: string; // 'YYYY-MM'（何月分の保険料か）
  employee: CoverageInput; // 生年月日と資格（EmployeeDoc をそのまま渡せる）
  remunerations: RemunerationLike[];
  rates: RatesForMonth; // その月の料率（pickRates の結果）
  options?: PremiumOptions;
}

export function calcMonthly(input: MonthlyInput): PremiumResult {
  const { month, rates } = input;
  const options = input.options ?? DEFAULT_PREMIUM_OPTIONS;
  const coverage = coverageForMonth(input.employee, month);
  const rem = latest(input.remunerations, month);

  const lines: PremiumLine[] = [];
  const missing: { part: PremiumPart; reason: MissingReason }[] = [];

  /** 1つの保険料を足す（標準報酬か料率がなければ missing へ。料率0%なら行を作らない） */
  const add = (
    part: PremiumPart,
    std: StandardRemuneration | undefined,
    rate: PickedRate | null,
  ) => {
    if (!std) missing.push({ part, reason: 'noRemuneration' });
    else if (!rate) missing.push({ part, reason: 'noRate' });
    else if (rate.employee + rate.employer > 0)
      lines.push(makeLine(part, std.standard, std.grade, rate));
  };

  if (coverage.health) {
    add('health', rem?.health, rates.health);
    if (coverage.care) add('care', rem?.health, rates.care);
    add('childSupport', rem?.health, rates.childSupport);
  }
  if (coverage.pension) {
    add('pension', rem?.pension, rates.pension);
    add('childContribution', rem?.pension, rates.childContribution);
  }

  return withTotals({ kind: 'monthly', month, groups: makeGroups(lines, options), missing });
}
