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
import { MultiOffice, StandardRemuneration } from '../../../core/models/remuneration';
import { CoverageInput, coverageForMonth } from '../../employees/logic/coverage';
import { latest, pickRates, RateTables } from '../../rates/logic/pick-rates';
import { makeGroups, makeLine, withTotals } from './premium-core';
import { exemptMonth, filedLeaves, LeaveHolder } from '../../employees/logic/leave';
import { AdjustmentInput } from './premium-adjustment';

/** 報酬の履歴のうち、計算に使う部分（RemunerationDoc をそのまま渡せる） */
export interface RemunerationLike {
  from: string;
  health: StandardRemuneration;
  pension: StandardRemuneration;
  /** 届出なしの一斉改定（等級の上限が上がった月）で足した行の印（cap-revision.ts。11/16） */
  capRevised?: readonly ('health' | 'pension')[];
  /** 二以上事業所勤務の按分（11/28） */
  multi?: MultiOffice | null;
}

export interface MonthlyInput {
  month: string; // 'YYYY-MM'（何月分の保険料か）
  employee: CoverageInput & LeaveHolder & { multipleOffices?: boolean }; // 生年月日・資格・休業（EmployeeDoc をそのまま渡せる）
  remunerations: RemunerationLike[];
  rates: RatesForMonth; // その月の料率（pickRates の結果）
  options?: PremiumOptions;
  /** 保険料調整制度の軽減割合（対象の月だけ。省くと軽減なし。11/16） */
  adjustment?: AdjustmentInput | null;
  /** この月、特定被保険者として介護保険料をかけるか（組合健保。special-insured.ts。省くとかけない。11/26） */
  specialInsured?: boolean;
  /**
   * 料率の表（二以上事業所勤務で、本人が別の都道府県の協会けんぽを選んだときに、その料率を選ぶ。11/28）
   * 省くと、そのときの健保は「料率なし」になる
   */
  tables?: RateTables;
}

/** 全額 × own ÷ total（0.001円未満は切り捨て。11/28） */
function shareMilli(v: number, own: number, total: number): number {
  return Number((BigInt(v) * BigInt(own)) / BigInt(total));
}

/** 二以上事業所勤務の按分（全額・本人分とも。11/28） */
export function shareLine(l: PremiumLine, own: number, total: number): PremiumLine {
  const out: PremiumLine = { ...l, totalMilli: shareMilli(l.totalMilli, own, total), employeeMilli: shareMilli(l.employeeMilli, own, total), share: { own, total } };
  if (l.reductionMilli) out.reductionMilli = shareMilli(l.reductionMilli, own, total);
  return out;
}

const HEALTH_PARTS: readonly PremiumPart[] = ['health', 'care', 'childSupport'];

export function calcMonthly(input: MonthlyInput): PremiumResult {
  const { month, rates } = input;
  const options = input.options ?? DEFAULT_PREMIUM_OPTIONS;
  const coverage = coverageForMonth(input.employee, month);
  const rem = latest(input.remunerations, month);

  // 産休・育休で免除の月：保険料の行を作らない（本人分・会社分とも免除。合計にも入らない）
  // 免除は申出をした休業だけ。申出がまだなら保険料をかけ、exemptPending で「申出すれば免除」と知らせる（11/19）
  const covered = coverage.health || coverage.pension;
  if (covered && exemptMonth(filedLeaves(input.employee.leaves), month)) {
    return withTotals({ kind: 'monthly', month, groups: [], missing: [], exempt: true });
  }
  const exemptPending = covered && exemptMonth(input.employee.leaves, month);

  const lines: PremiumLine[] = [];
  const missing: { part: PremiumPart; reason: MissingReason }[] = [];

  // 二以上事業所勤務（11/28）：按分の割合と、本人が選んだ健康保険
  const isMulti = !!input.employee.multipleOffices;
  const multi = isMulti ? (rem?.multi ?? null) : null;
  const healthRates: RatesForMonth | null =
    multi?.insurer === 'kyokai' && multi.prefecture
      ? input.tables
        ? pickRates({ prefecture: multi.prefecture, healthInsurer: { type: 'kyokai' } }, input.tables, month)
        : null
      : rates;

  /** 1つの保険料を足す（標準報酬か料率がなければ missing へ。料率0%なら行を作らない） */
  const add = (
    part: PremiumPart,
    std: StandardRemuneration | undefined,
    rate: PickedRate | null,
  ) => {
    const adjustBp = part === 'health' ? (input.adjustment?.health ?? 0) : part === 'pension' ? (input.adjustment?.pension ?? 0) : 0;
    if (!std) missing.push({ part, reason: 'noRemuneration' });
    else if (multi?.insurer === 'other' && HEALTH_PARTS.includes(part)) missing.push({ part, reason: 'otherInsurer' });
    else if (!rate) missing.push({ part, reason: 'noRate' });
    else if (rate.employee + rate.employer > 0)
      lines.push(makeLine(part, std.standard, std.grade, rate, adjustBp));
  };

  // 特定被保険者：本人は介護保険の第2号被保険者でないが、40〜64歳の被扶養者がいる（規約で定めた組合だけ）
  const special = coverage.health && !coverage.care && !!input.specialInsured;
  if (coverage.health) {
    add('health', rem?.health, healthRates?.health ?? null);
    if (coverage.care || special) add('care', rem?.health, healthRates?.care ?? null);
    add('childSupport', rem?.health, healthRates?.childSupport ?? null);
  }
  if (coverage.pension) {
    add('pension', rem?.pension, rates.pension);
    add('childContribution', rem?.pension, rates.childContribution);
  }

  const shared = multi && multi.own < multi.total ? lines.map((l) => shareLine(l, multi.own, multi.total)) : lines;
  return withTotals({
    kind: 'monthly',
    month,
    groups: makeGroups(shared, options),
    missing,
    ...(exemptPending ? { exemptPending: true } : {}),
    ...(special ? { specialInsured: true } : {}),
    ...(isMulti ? { multiOffice: multi ? 'shared' : 'noShare' } : {}),
  });
}
