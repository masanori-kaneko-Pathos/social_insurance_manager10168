/**
 * 社会保険の適用期間の判定（月単位）
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 * 日付は 'YYYY-MM-DD'、年月は 'YYYY-MM' の文字列で扱う（文字列のまま大小比較できる）。
 */

import {
  addDays,
  dateOf,
  DateStr,
  daysInMonth,
  toYearMonth,
  YearMonth,
} from '../../../shared/utils/date';
import { careExemptMonth, CareExemptionLike } from './care-exemption';
import { contractAt } from './contract-form-model';

export interface Enrollment {
  enrolled: boolean;
  acquiredDate: DateStr | null; // 資格取得日
  lostDate: DateStr | null; // 資格喪失日（退職日の翌日など）
}

export interface CoverageInput {
  birthDate: DateStr;
  health: Enrollment;
  pension: Enrollment;
  /** 介護保険の適用除外（R4。ない・空なら除外なし） */
  careExemptions?: readonly CareExemptionLike[];
}

export interface MonthlyCoverage {
  month: YearMonth;
  health: boolean;
  care: boolean;
  pension: boolean;
}

// ===== 2. 年齢 =====

/** その年齢の誕生日（2/29生まれで平年の場合は 3/1 になる） */
export function birthdayAt(birthDate: DateStr, age: number): DateStr {
  const [y, m, d] = birthDate.split('-').map(Number);
  return dateOf(y + age, m, d);
}

/** 法律上の年齢到達日 ＝ 誕生日の前日（年齢計算ニ関スル法律） */
export function ageReachDate(birthDate: DateStr, age: number): DateStr {
  return addDays(birthdayAt(birthDate, age), -1);
}

// ===== 3. 1つの保険の判定 =====

/** 早いほうの日付（null は「なし」として扱う） */
function earlier(a: DateStr | null, b: DateStr | null): DateStr | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/**
 * その月に保険料がかかるか
 * - 取得した月から、喪失した月の前月まで
 * - 同じ月に取得して喪失した場合は、その月はかかる（同月得喪）
 */
export function isChargedMonth(
  acquiredDate: DateStr | null,
  lostDate: DateStr | null,
  month: YearMonth,
): boolean {
  if (!acquiredDate) return false;
  // 取得する日までに喪失している（70歳到達日・75歳の誕生日より後に入社した など）なら、資格を取っていない
  if (lostDate && lostDate <= acquiredDate) return false;
  const acquired = toYearMonth(acquiredDate);
  if (month < acquired) return false;
  if (!lostDate) return true;

  const lost = toYearMonth(lostDate);
  if (lost === acquired) return month === acquired; // 同月得喪
  return month < lost;
}

// ===== 4・5. 年齢による喪失と介護保険 =====

/** 厚生年金：70歳到達日で喪失 */
export function pensionLostDate(input: CoverageInput): DateStr | null {
  return earlier(input.pension.lostDate, ageReachDate(input.birthDate, 70));
}

/** 健康保険：75歳の誕生日に後期高齢者医療へ移るため喪失 */
export function healthLostDate(input: CoverageInput): DateStr | null {
  return earlier(input.health.lostDate, birthdayAt(input.birthDate, 75));
}

export function coverageForMonth(input: CoverageInput, month: YearMonth): MonthlyCoverage {
  const health =
    input.health.enrolled &&
    isChargedMonth(input.health.acquiredDate, healthLostDate(input), month);

  const pension =
    input.pension.enrolled &&
    isChargedMonth(input.pension.acquiredDate, pensionLostDate(input), month);

  const care = health && isCareMonth(input, month);

  return { month, health, care, pension };
}

/**
 * 介護保険の第2号被保険者の月か（健康保険の加入は見ない）
 * - 40歳到達の月 〜 65歳到達の月の前月
 * - ただし、介護保険の適用除外の月は除く（care-exemption.ts）
 */
export function isCareMonth(input: Pick<CoverageInput, 'birthDate' | 'careExemptions'>, month: YearMonth): boolean {
  const careStart = toYearMonth(ageReachDate(input.birthDate, 40));
  const careEnd = toYearMonth(ageReachDate(input.birthDate, 65));
  return month >= careStart && month < careEnd && !careExemptMonth(input.careExemptions, month);
}

// ===== 6. 期間の一覧 =====

export function coverageForMonths(input: CoverageInput, months: YearMonth[]): MonthlyCoverage[] {
  return months.map((m) => coverageForMonth(input, m));
}

/** 入社日・退職日から、取得日・喪失日の初期値を出す（E2） */
export function defaultEnrollmentDates(hireDate: DateStr, retireDate: DateStr | null) {
  return {
    acquiredDate: hireDate,
    lostDate: retireDate ? addDays(retireDate, 1) : null,
  };
}

// ===== 7. 4分の3基準と特定適用事業所（短時間労働者の加入） =====

/** 通常の労働者の所定（事業所の設定）と、1人の契約の所定。どちらも同じ形 */
export interface WorkSchedule {
  weeklyMinutes: number; // 週の所定労働時間（分）
  monthlyDays: number; // 月の所定労働日数
}

/**
 * 4分の3基準（日本年金機構「短時間労働者に対する適用拡大」）
 * - meets：週の所定労働時間と月の所定労働日数が、どちらも通常の労働者の4分の3以上（一般の被保険者）
 * - below：どちらかが4分の3未満（短時間労働者として判定する）
 * - unknown：事業所の所定が入っていないので判定できない
 * 小数を出さないよう「× 4 と × 3」で比べる（週40時間なら 30時間ちょうどは meets）
 */
export type ThreeQuarters = 'meets' | 'below' | 'unknown';

export function threeQuartersOf(work: WorkSchedule, standard: WorkSchedule | null): ThreeQuarters {
  if (!standard) return 'unknown';
  const hoursOk = work.weeklyMinutes * 4 >= standard.weeklyMinutes * 3;
  const daysOk = work.monthlyDays * 4 >= standard.monthlyDays * 3;
  return hoursOk && daysOk ? 'meets' : 'below';
}

/**
 * その月に特定適用事業所か（任意特定適用も含む）
 * 一度該当すると、人数が減っても自動では外れない（年金機構の扱い）ので、該当した月以後はずっと true
 */
export function isSpecificApplied(
  s: { since: YearMonth | null } | null | undefined,
  month: YearMonth,
): boolean {
  return !!s?.since && s.since <= month;
}

/** その月に使う加入の基準（masterCriteria のうち、from がその月以前でいちばん新しい行。なければ null） */
export function criteriaAt<T extends { from: YearMonth }>(rows: T[], month: YearMonth): T | null {
  let best: T | null = null;
  for (const r of rows) if (r.from <= month && (!best || r.from > best.from)) best = r;
  return best;
}

/** 人数を数えるときに使う従業員の項目 */
export interface HeadcountTarget {
  birthDate: DateStr;
  hireDate: DateStr;
  retireDate: DateStr | null;
  contracts: (WorkSchedule & { from: DateStr })[];
}

export interface Headcount {
  counted: number; // 数えた人（企業規模の人数）
  noContract: number; // 在籍・70歳未満だが、その月の契約がなくて判定できなかった人
}

/**
 * 企業規模の人数（厚生年金の被保険者の数え方）
 * - その月に在籍している（入社の月 〜 退職の月）
 * - 70歳未満（70歳到達の月より前。厚年の資格がある人）
 * - その月の末日に効いている契約が、4分の3基準を満たす（短時間労働者は数えない）
 * 事業所の所定がなければ数えられないので null
 */
export function countHeadcount(
  people: HeadcountTarget[],
  standard: WorkSchedule | null,
  month: YearMonth,
): Headcount | null {
  if (!standard) return null;
  const monthEnd = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  let counted = 0;
  let noContract = 0;
  for (const p of people) {
    if (toYearMonth(p.hireDate) > month) continue;
    if (p.retireDate && toYearMonth(p.retireDate) < month) continue;
    if (month >= toYearMonth(ageReachDate(p.birthDate, 70))) continue;
    const contract = contractAt(p.contracts, monthEnd);
    if (!contract) {
      noContract++;
      continue;
    }
    if (threeQuartersOf(contract, standard) === 'meets') counted++;
  }
  return { counted, noContract };
}
