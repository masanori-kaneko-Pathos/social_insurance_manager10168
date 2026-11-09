// 定時決定（4・5・6月に支払った報酬の平均 → 9月分からの標準報酬月額）と、年間平均（保険者算定）の候補
// Angular・Firebase に依存しない純粋な関数。等級表は 9月分の表を呼び出し側で選んで渡す
//
// 根拠（日本年金機構）
// - 「被保険者報酬月額算定基礎届」の手続概要：対象から除く人、保険者算定の①〜⑤
//   （遡及の差額・低額の休職給・途中入社月・年間平均）
// - 「保険者算定（年間平均）の手続きについて」：要件、対象となる場合（3月までの資格取得、1等級差の例外）
// ※ 支払基礎日数は今は17日だけ（短時間労働者11日・パート15日は雇用契約の区分ができたら足す）
// ※ 一時帰休（休業手当）の特例はまだ入れていない

import type { GradeRow } from '../../../core/models/rates';
import type { RemunerationDoc, StandardRemuneration } from '../../../core/models/remuneration';
import type { Payroll } from '../../../core/models/payroll';
import { gradeOf } from '../../rates/logic/grade';
import { PayrollEmployee, PaySchedule, periodOf } from './payroll-rows';
import { shiftMonth } from '../../../shared/utils/date';

export const REGULAR_MIN_DAYS = 17;

export type Remuneration = Pick<RemunerationDoc, 'from' | 'reason' | 'monthlyAmount' | 'health' | 'pension'>;

export interface GradeRows {
  health: GradeRow[];
  pension: GradeRow[];
}

export interface Standards {
  health: StandardRemuneration;
  pension: StandardRemuneration | null; // 厚年の資格がない（70歳以上など）ときは null
}

/** 1か月が平均に使えない理由 */
export type MonthSkip = 'noRecord' | 'shortDays' | 'partialAcquisition' | 'suspended';

export interface MonthUse {
  month: string; // 支払った月
  payroll: Payroll | null;
  used: boolean;
  skip: MonthSkip | null;
  /** 通貨＋現物 */
  amount: number;
}

export type RegularStatus =
  | 'excluded' // 定時決定の対象外
  | 'incomplete' // 4〜6月の実績が入っていない月がある（決められない）
  | 'keep' // 3か月とも使えない → 従前の標準報酬（保険者決定）
  | 'decided';

export type ExcludedReason =
  | 'notInsured' // 7月1日に被保険者でない
  | 'acquiredFromJune' // 6月1日以降に資格取得
  | 'irregular'; // 7・8・9月に随時改定がある

export interface AnnualCandidate {
  months: MonthUse[]; // 前年7月〜当年6月
  usedCount: number;
  average: number;
  next: Standards;
  healthDiff: number; // 通常 − 年間平均（等級。プラスなら通常のほうが高い）
  pensionDiff: number | null;
  /** 年間平均の候補（2等級以上の差、または1等級差の例外。健保か厚年のどちらか） */
  candidate: boolean;
  /** 1等級差の例外にあたった（上限・下限の近く） */
  exception: boolean;
  /** 12か月のうち実績が入っていない月がある */
  incomplete: boolean;
}

export interface RegularResult {
  employeeId: string;
  status: RegularStatus;
  excluded: ExcludedReason | null;
  months: MonthUse[]; // 4・5・6月
  usedCount: number;
  /** 平均（遡及支払額を含む） */
  rawAverage: number | null;
  /** 遡及支払額を除いた平均（修正平均）。遡及がなければ rawAverage と同じ */
  average: number | null;
  hasRetro: boolean;
  /** 従前（8月分の標準報酬） */
  current: Standards | null;
  /** 9月分から（keep のときは current と同じ） */
  next: Standards | null;
  change: 'up' | 'down' | 'same' | null;
  annual: AnnualCandidate | null;
}

// ===== 小さな道具 =====

interface Enr {
  enrolled: boolean;
  acquiredDate: string | null;
  lostDate: string | null;
}

/** その日に被保険者か */
function insuredOn(x: Enr, date: string): boolean {
  return (
    x.enrolled &&
    x.acquiredDate != null &&
    x.acquiredDate <= date &&
    (x.lostDate == null || x.lostDate > date)
  );
}

/** その月分に使う標準報酬（from がその月以前で一番新しいもの） */
export function remunerationAt(list: readonly Remuneration[], month: string): Remuneration | null {
  let found: Remuneration | null = null;
  for (const r of list) {
    if (r.from <= month && (!found || r.from > found.from)) found = r;
  }
  return found;
}

function standardsOf(rows: GradeRows, amount: number, withPension: boolean): Standards {
  return {
    health: gradeOf(rows.health, amount),
    pension: withPension ? gradeOf(rows.pension, amount) : null,
  };
}

/**
 * 月ごとに使えるかを見る
 * - 実績がない → noRecord
 * - 資格を取った日が対象期間の途中（その月は1か月分が出ていない）→ partialAcquisition
 * - 支払基礎日数が17日未満 → shortDays
 */
function useMonth(
  month: string,
  payroll: Payroll | undefined,
  acquiredDate: string | null,
  schedule: PaySchedule,
): MonthUse {
  if (!payroll) return { month, payroll: null, used: false, skip: 'noRecord', amount: 0 };
  const amount = payroll.cash + payroll.inKind;
  const p = periodOf(month, schedule);
  let skip: MonthSkip | null = null;
  if (acquiredDate != null && acquiredDate > p.start && acquiredDate <= p.end) {
    skip = 'partialAcquisition'; // 保険者算定⑤
  } else if (payroll.days < REGULAR_MIN_DAYS) {
    skip = 'shortDays';
  } else if (payroll.state === 'suspended') {
    skip = 'suspended'; // 保険者算定②（低額の休職給の月は除く）
  }
  return { month, payroll, used: skip === null, skip, amount };
}

/** 平均（1円未満切り捨て）。withoutRetro なら遡及支払額を引く */
function averageOf(months: MonthUse[], withoutRetro: boolean): number {
  const used = months.filter((m) => m.used);
  const sum = used.reduce((s, m) => s + m.amount - (withoutRetro ? m.payroll!.retro : 0), 0);
  return Math.floor(sum / used.length);
}

/**
 * 1等級差でも年間平均の対象になる例外（上限・下限の近く）
 * 等級表の外側に「もう1つ上（下）の等級があったら」2等級差になる、という場合。
 * 資料の金額（厚年：66.5万円以上 と 60.5万〜63.5万円未満 など）を、等級表から出す
 * - 上：片方が「最上位の下限 ＋ (最上位の下限 − その1つ下の下限)」以上、もう片方が最上位の1つ下の等級
 * - 下：片方が「1級の標準報酬 − (2級の下限 − 1級の標準報酬)」未満、もう片方が2級
 *   厚年：66.5万円以上 と 60.5万〜63.5万円未満（資料と一致）
 *   健保：141.5万円以上 と 129.5万〜135.5万円未満、5.3万円未満 と 6.3万〜7.3万円未満
 *   （11/9 に年金機構「随時改定」のページの表（厚年 66.5万・8.3万、健保 141.5万・5.3万）と一致を確認。sources.md R3）
 * 随時改定（irregular.ts）でも、従前の報酬月額と平均でこの関数を使う
 */
export function oneGradeException(rows: GradeRow[], a: number, b: number): boolean {
  const sorted = [...rows].sort((x, y) => x.grade - y.grade);
  const n = sorted.length;
  const top = sorted[n - 1];
  const second = sorted[n - 2];
  const upper = top.min + (top.min - second.min);
  const inSecond = (v: number) => v >= second.min && v < top.min;

  const g1 = sorted[0];
  const g2 = sorted[1];
  const g3 = sorted[2];
  const lower = g1.standard - (g2.min - g1.standard);
  const inG2 = (v: number) => v >= g2.min && v < g3.min;

  const pair = (x: number, y: number) => (x >= upper && inSecond(y)) || (x < lower && inG2(y));
  return pair(a, b) || pair(b, a);
}

// ===== 本体 =====

export interface RegularInput {
  year: number;
  employee: PayrollEmployee;
  /** 支払った月 → 実績（その人の分） */
  payrolls: ReadonlyMap<string, Payroll>;
  remunerations: readonly Remuneration[];
  /** 9月分に使う等級表 */
  grades: GradeRows;
  schedule: PaySchedule;
}

export function decideRegular(x: RegularInput): RegularResult {
  const y = x.year;
  const july1 = `${y}-07-01`;
  const e = x.employee;
  const base: RegularResult = {
    employeeId: e.id,
    status: 'excluded',
    excluded: null,
    months: [],
    usedCount: 0,
    rawAverage: null,
    average: null,
    hasRetro: false,
    current: null,
    next: null,
    change: null,
    annual: null,
  };

  // --- 対象者か ---
  const health = insuredOn(e.health, july1);
  const pension = insuredOn(e.pension, july1);
  if (!health && !pension) return { ...base, excluded: 'notInsured' };

  const acquired = [health ? e.health.acquiredDate : null, pension ? e.pension.acquiredDate : null]
    .filter((d): d is string => d != null)
    .sort()[0];
  if (acquired >= `${y}-06-01`) return { ...base, excluded: 'acquiredFromJune' };

  const irregular = x.remunerations.some(
    (r) => r.reason === 'irregular' && r.from >= `${y}-07` && r.from <= `${y}-09`,
  );
  if (irregular) return { ...base, excluded: 'irregular' };

  // --- 従前（8月分） ---
  const cur = remunerationAt(x.remunerations, `${y}-08`);
  const current: Standards | null = cur
    ? { health: cur.health, pension: pension ? cur.pension : null }
    : null;

  // --- 4・5・6月 ---
  const months = ['04', '05', '06'].map((m) =>
    useMonth(`${y}-${m}`, x.payrolls.get(`${y}-${m}`), acquired, x.schedule),
  );
  const usedCount = months.filter((m) => m.used).length;
  const withMonths = { ...base, excluded: null, months, usedCount, current };

  if (months.some((m) => m.skip === 'noRecord')) {
    return { ...withMonths, status: 'incomplete' };
  }
  if (usedCount === 0) {
    return { ...withMonths, status: 'keep', next: current, change: current ? 'same' : null };
  }

  const rawAverage = averageOf(months, false);
  const average = averageOf(months, true);
  const next = standardsOf(x.grades, average, pension);
  const change = !current
    ? null
    : next.health.grade > current.health.grade
      ? 'up'
      : next.health.grade < current.health.grade
        ? 'down'
        : 'same';

  // --- 年間平均（前年7月〜当年6月） ---
  const annualMonths = Array.from({ length: 12 }, (_, i) => {
    const m = shiftMonth(`${y - 1}-07`, i);
    return useMonth(m, x.payrolls.get(m), acquired, x.schedule);
  });
  const annualUsed = annualMonths.filter((m) => m.used).length;
  // 年間平均の対象は「当年3月までに資格取得した人」
  const annualEligible = acquired <= `${y}-03-31`;
  let annual: AnnualCandidate | null = null;
  if (annualEligible && annualUsed > 0) {
    const aAvg = averageOf(annualMonths, true);
    const aNext = standardsOf(x.grades, aAvg, pension);
    const healthDiff = next.health.grade - aNext.health.grade;
    const pensionDiff =
      next.pension && aNext.pension ? next.pension.grade - aNext.pension.grade : null;
    const twoGrades =
      Math.abs(healthDiff) >= 2 || (pensionDiff != null && Math.abs(pensionDiff) >= 2);
    const exception =
      !twoGrades &&
      (oneGradeException(x.grades.health, average, aAvg) ||
        (pension && oneGradeException(x.grades.pension, average, aAvg)));
    const candidate = twoGrades || exception;
    annual = {
      months: annualMonths,
      usedCount: annualUsed,
      average: aAvg,
      next: aNext,
      healthDiff,
      pensionDiff,
      candidate,
      exception,
      incomplete: annualMonths.some((m) => m.skip === 'noRecord'),
    };
  }

  return {
    ...withMonths,
    status: 'decided',
    rawAverage,
    average,
    hasRetro: average !== rawAverage,
    next,
    change,
    annual,
  };
}

/** 定時決定の年：6月の支払日を過ぎていれば今年、まだなら去年 */
export function regularYearOf(latestPaidMonth: string): number {
  const y = Number(latestPaidMonth.slice(0, 4));
  return latestPaidMonth.slice(5, 7) >= '06' ? y : y - 1;
}
