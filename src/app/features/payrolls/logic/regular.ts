// 定時決定（4・5・6月に支払った報酬の平均 → 9月分からの標準報酬月額）と、年間平均（保険者算定）の候補
// Angular・Firebase に依存しない純粋な関数。等級表は 9月分の表を呼び出し側で選んで渡す
//
// 根拠（日本年金機構）
// - 「被保険者報酬月額算定基礎届」の手続概要：対象から除く人、保険者算定の①〜⑤
//   （遡及の差額・低額の休職給・途中入社月・年間平均）
// - 「保険者算定（年間平均）の手続きについて」：要件、対象となる場合（3月までの資格取得、1等級差の例外）
// - 支払基礎日数（日本年金機構「定時決定」5・6。R47）：一般は17日以上の月。特定適用事業所の短時間労働者は11日以上の月。
//   短時間就労者（パート）は17日以上の月 → なければ15日以上の月 → なければ従前（11/16 に入れた）
// - 一時帰休（休業手当。11/19）：算定基礎届の記入・提出ガイドブック「一時帰休による休業手当が支給されているとき」
//   7月1日の時点で解消していれば、休業手当を受けた月を除いて平均。解消していなければ、休業手当を含めて平均
//   アプリは「6月の実績が一時帰休でない」ことで解消したとみなす

import type { GradeRow } from '../../../core/models/rates';
import type { RemunerationDoc, StandardRemuneration } from '../../../core/models/remuneration';
import { payTotal, type Payroll } from '../../../core/models/payroll';
import { gradeOf } from '../../rates/logic/grade';
import { PayrollEmployee, PaySchedule, periodOf } from './payroll-rows';
import { shiftMonth } from '../../../shared/utils/date';
import { MIN_DAYS_PART_FALLBACK } from './revision-base';
import { forWindow } from './spread';

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

/** 1か月が平均に使えない理由（furloughResolved：7/1までに解消した一時帰休の月。11/19） */
/** beforeAcquisition：給与の計算期間が資格を取る前に終わっている月（4/1入社・翌月払いの4月払いなど。払う給与がないので「未入力」ではない。11/20） */
export type MonthSkip = 'noRecord' | 'beforeAcquisition' | 'shortDays' | 'partialAcquisition' | 'suspended' | 'furloughResolved';

export interface MonthUse {
  month: string; // 支払った月
  payroll: Payroll | null;
  used: boolean;
  skip: MonthSkip | null;
  /** 通貨＋現物（＋賞与に係る報酬。年4回以上の賞与の 年額÷12 を各月に足す。11/19） */
  amount: number;
  /** この月の支払基礎日数の基準（17・11、パートの読み替えで15）。11/16 */
  minDays: number;
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
  /** 各月の報酬に足した賞与に係る報酬（年4回以上の賞与の 年額÷12。なければ 0。11/19） */
  bonusMonthly: number;
  /**
   * 4〜6月とも休業手当で、7/1までに一時帰休が解消したとき、決定に使った標準報酬の適用月（11/25）
   * 休業手当による随時改定を飛ばした、その前の標準報酬（事務取扱いの事例集 一時帰休（定時決定）問7）。ふだんは null
   */
  restoredFrom: string | null;
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
  minDays: number = REGULAR_MIN_DAYS,
  bonusMonthly = 0,
): MonthUse {
  const p = periodOf(month, schedule);
  if (!payroll) {
    // 計算期間が資格を取る前に終わっていれば、その月は払う給与がない（入社前）。除くだけで「未入力」にはしない（11/20）
    const before = acquiredDate != null && acquiredDate > p.end;
    return { month, payroll: null, used: false, skip: before ? 'beforeAcquisition' : 'noRecord', amount: 0, minDays };
  }
  // 賞与に係る報酬は各月の報酬に足す（局部長通知 2(1)。算定基礎届も各月の額に足して書く）
  const amount = payTotal(payroll) + bonusMonthly;
  let skip: MonthSkip | null = null;
  if (acquiredDate != null && acquiredDate > p.start && acquiredDate <= p.end) {
    skip = 'partialAcquisition'; // 保険者算定⑤
  } else if (payroll.days < minDays) {
    skip = 'shortDays';
  } else if (payroll.state === 'suspended') {
    skip = 'suspended'; // 保険者算定②（低額の休職給の月は除く）
  }
  return { month, payroll, used: skip === null, skip, amount, minDays };
}

/**
 * 3か月（年間平均なら12か月）の使える月を決める
 * パートで基準（17日）以上の月が1か月もなければ、15日以上の月を使う（日数だけで外れた月を15日で見直す）
 */
function useMonths(
  list: string[],
  x: RegularInput,
  acquired: string | null,
): MonthUse[] {
  const minDaysAt = x.minDaysAt ?? (() => REGULAR_MIN_DAYS);
  const bonus = x.bonusMonthly ?? 0;
  const months = list.map((m) => useMonth(m, x.payrolls.get(m), acquired, x.schedule, minDaysAt(m), bonus));
  const partAt = x.partAt;
  if (!partAt || months.some((m) => m.used) || !months.every((m) => m.skip === 'noRecord' || m.skip === 'beforeAcquisition' || partAt(m.month))) {
    return months;
  }
  return months.map((m) =>
    m.skip === 'shortDays'
      ? useMonth(m.month, x.payrolls.get(m.month), acquired, x.schedule, MIN_DAYS_PART_FALLBACK, bonus)
      : m,
  );
}

/**
 * 一時帰休が7月1日までに解消していれば、休業手当を受けた月（状態が一時帰休の月）を平均から除く（11/19）
 * 解消したかは 7月1日の時点で見る（事例集 5(1) 問3・4）：6月の実績が一時帰休でない、
 * または 7月に払った給与（july）がもう入っていて一時帰休でない（6月の途中で解消したなど）なら解消
 * 解消していなければ、休業手当を含めたまま平均する
 */
export function withoutResolvedFurlough(months: MonthUse[], july: Payroll | null = null): MonthUse[] {
  const june = months[months.length - 1];
  const any = months.some((m) => m.payroll?.state === 'furlough');
  const juneOk = !!june?.payroll && june.payroll.state !== 'furlough';
  const julyOk = !!july && july.state !== 'furlough';
  if (!any || !(juneOk || julyOk)) return months;
  return months.map((m) =>
    m.payroll?.state === 'furlough' && m.used ? { ...m, used: false, skip: 'furloughResolved' as const } : m,
  );
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
  /** その支払月の支払基礎日数の基準（特定適用事業所の短時間労働者は11日）。省くと17日 */
  minDaysAt?: (paidMonth: string) => number;
  /** その支払月、短時間就労者（4分の3以上のパート・アルバイト）か。省くとパートの読み替えをしない */
  partAt?: (paidMonth: string) => boolean;
  /** 賞与に係る報酬（年4回以上の賞与の 7/1前1年の額 ÷ 12）。各月の報酬に足す。省くと 0（11/19。bonus-nature.ts） */
  bonusMonthly?: number;
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
    bonusMonthly: x.bonusMonthly ?? 0,
    restoredFrom: null,
  };

  // --- 対象者か ---
  const health = insuredOn(e.health, july1);
  const pension = insuredOn(e.pension, july1);
  if (!health && !pension) return { ...base, excluded: 'notInsured' };

  const acquired = [health ? e.health.acquiredDate : null, pension ? e.pension.acquiredDate : null]
    .filter((d): d is string => d != null)
    .sort()[0];
  if (acquired >= `${y}-06-01`) return { ...base, excluded: 'acquiredFromJune' };

  // 7〜9月に随時改定・休業終了時改定・特例改定がある人は対象外（◎ 健保法41条3項「改定され、又は改定されるべき」。反映前の候補は画面の札で知らせる。11/16 に条文を確認）
  const irregular = x.remunerations.some(
    (r) =>
      (r.reason === 'irregular' || r.reason === 'leaveEnd' || r.reason === 'special') && r.from >= `${y}-07` && r.from <= `${y}-09`,
  );
  if (irregular) return { ...base, excluded: 'irregular' };

  // --- 従前（8月分） ---
  const cur = remunerationAt(x.remunerations, `${y}-08`);
  const current: Standards | null = cur
    ? { health: cur.health, pension: pension ? cur.pension : null }
    : null;

  // --- 4・5・6月 ---
  // まとめて払った定期代の全部が4〜6月に入るときは、総額が変わらないように割り振る（疑義照会回答 月額変更届 15。11/26）
  const threeMonths = ['04', '05', '06'].map((m) => `${y}-${m}`);
  const months = withoutResolvedFurlough(
    useMonths(threeMonths, { ...x, payrolls: forWindow(x.payrolls, threeMonths) }, acquired),
    x.payrolls.get(`${y}-07`) ?? null,
  );
  const usedCount = months.filter((m) => m.used).length;
  const withMonths = { ...base, excluded: null, months, usedCount, current };

  if (months.some((m) => m.skip === 'noRecord')) {
    return { ...withMonths, status: 'incomplete' };
  }
  if (usedCount === 0) {
    // 4〜6月とも休業手当で7/1までに解消：休業手当を含まずに決定・改定された直近の標準報酬で決める（一時帰休（定時決定）問7。11/25）
    const restored = months.some((m) => m.skip === 'furloughResolved') ? withoutFurloughAt(x.remunerations, x.payrolls, `${y}-08`) : null;
    if (restored && cur && restored !== cur) {
      const next: Standards = { health: restored.health, pension: pension ? restored.pension : null };
      return {
        ...withMonths,
        status: 'decided',
        rawAverage: restored.monthlyAmount,
        average: restored.monthlyAmount,
        next,
        change: changeOf(current, next),
        restoredFrom: restored.from,
      };
    }
    return { ...withMonths, status: 'keep', next: current, change: current ? 'same' : null };
  }

  const rawAverage = averageOf(months, false);
  const average = averageOf(months, true);
  const next = standardsOf(x.grades, average, pension);
  const change = changeOf(current, next);

  // --- 年間平均（前年7月〜当年6月） ---
  const twelve = Array.from({ length: 12 }, (_, i) => shiftMonth(`${y - 1}-07`, i));
  const annualMonths = useMonths(twelve, { ...x, payrolls: forWindow(x.payrolls, twelve) }, acquired);
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

function changeOf(current: Standards | null, next: Standards): RegularResult['change'] {
  if (!current) return null;
  return next.health.grade > current.health.grade ? 'up' : next.health.grade < current.health.grade ? 'down' : 'same';
}

/**
 * 休業手当による随時改定か：改定のもとになった3か月（適用月の前の3か月）に、一時帰休の月がある（11/25）
 * 給与の実績が読み込まれていない月は、一時帰休でないとみなす
 */
function byFurlough(r: Remuneration, payrolls: ReadonlyMap<string, Payroll>): boolean {
  return r.reason === 'irregular' && [1, 2, 3].some((i) => payrolls.get(shiftMonth(r.from, -i))?.state === 'furlough');
}

/** その月分に使う標準報酬のうち、休業手当による随時改定を飛ばした直近のもの（なければ null） */
export function withoutFurloughAt(list: readonly Remuneration[], payrolls: ReadonlyMap<string, Payroll>, month: string): Remuneration | null {
  const sorted = list.filter((r) => r.from <= month).sort((a, b) => b.from.localeCompare(a.from));
  return sorted.find((r) => !byFurlough(r, payrolls)) ?? null;
}

/**
 * 算定基礎届の ⑭総計・⑮平均額・⑯修正平均額（11/25）
 * ふつうは、平均に使った月の総計と平均。遡及支払額があれば修正平均（遡及を除く）
 * 7/1までに一時帰休が解消した人は、ガイドブック ケース⑧の記入例どおり、⑭⑮は休業手当の月も含めた3か月で書き、
 * ⑯修正平均に休業手当の月を除いた平均を書く（4〜6月とも休業手当なら ⑯ は空）
 */
export function regularFormAmounts(r: Pick<RegularResult, 'months' | 'usedCount' | 'rawAverage' | 'average' | 'hasRetro'>): {
  total: number;
  average: number;
  corrected: number | null;
} {
  const used = r.months.filter((m) => m.used);
  if (r.months.some((m) => m.skip === 'furloughResolved')) {
    const all = r.months.filter((m) => m.used || m.skip === 'furloughResolved');
    const total = all.reduce((s, m) => s + m.amount, 0);
    return { total, average: Math.floor(total / all.length), corrected: r.usedCount > 0 ? r.average : null };
  }
  return { total: used.reduce((s, m) => s + m.amount, 0), average: r.rawAverage ?? 0, corrected: r.hasRetro ? r.average : null };
}

/**
 * 70歳以上被用者の標準報酬月額相当額に使う月と平均（11/25）
 * 平均に使った月のうち、給与の計算期間の初日が70歳到達日以後の月だけ（到達日より前の日の給与を含む月は除く）
 * 算定基礎届の記入・提出ガイドブック ケース⑥：4/9 到達・月末締めなら、6月払い（5/1〜5/31）だけ。遡及支払額は除く
 * 使える月がなければ null（健康保険と同じ平均を使う）
 */
export function over70Basis(
  months: readonly MonthUse[],
  schedule: PaySchedule,
  reachDate: string,
): { months: string[]; average: number } | null {
  const use = months.filter((m) => m.used && periodOf(m.month, schedule).start >= reachDate);
  if (use.length === 0) return null;
  const sum = use.reduce((s, m) => s + m.amount - m.payroll!.retro, 0);
  return { months: use.map((m) => m.month), average: Math.floor(sum / use.length) };
}

/** 定時決定の年：6月の支払日を過ぎていれば今年、まだなら去年 */
export function regularYearOf(latestPaidMonth: string): number {
  const y = Number(latestPaidMonth.slice(0, 4));
  return latestPaidMonth.slice(5, 7) >= '06' ? y : y - 1;
}
