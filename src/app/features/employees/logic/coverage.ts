/**
 * 社会保険の適用期間の判定（月単位）
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 * 日付は 'YYYY-MM-DD'、年月は 'YYYY-MM' の文字列で扱う（文字列のまま大小比較できる）。
 */

export type DateStr = string; // 'YYYY-MM-DD'
export type YearMonth = string; // 'YYYY-MM'

export interface Enrollment {
  enrolled: boolean;
  acquiredDate: DateStr | null; // 資格取得日
  lostDate: DateStr | null; // 資格喪失日（退職日の翌日など）
}

export interface CoverageInput {
  birthDate: DateStr;
  health: Enrollment;
  pension: Enrollment;
}

export interface MonthlyCoverage {
  month: YearMonth;
  health: boolean;
  care: boolean;
  pension: boolean;
}

// ===== 1. 日付の小道具（タイムゾーンの影響を受けないよう UTC で計算） =====

function toUtc(date: DateStr): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(dt: Date): DateStr {
  return dt.toISOString().slice(0, 10);
}

export function addDays(date: DateStr, days: number): DateStr {
  const dt = toUtc(date);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fromUtc(dt);
}

export function toYearMonth(date: DateStr): YearMonth {
  return date.slice(0, 7);
}

// ===== 2. 年齢 =====

/** その年齢の誕生日（2/29生まれで平年の場合は 3/1 になる） */
export function birthdayAt(birthDate: DateStr, age: number): DateStr {
  const [y, m, d] = birthDate.split('-').map(Number);
  return fromUtc(new Date(Date.UTC(y + age, m - 1, d)));
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

  // 介護保険：健康保険の保険料がかかっていて、40歳到達の月 〜 65歳到達の月の前月
  const careStart = toYearMonth(ageReachDate(input.birthDate, 40));
  const careEnd = toYearMonth(ageReachDate(input.birthDate, 65));
  const care = health && month >= careStart && month < careEnd;

  return { month, health, care, pension };
}

// ===== 6. 期間の一覧 =====

export function shiftMonth(month: YearMonth, diff: number): YearMonth {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + diff;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** 年度（4月〜翌3月） */
export function monthsOfFiscalYear(fiscalYear: number): YearMonth[] {
  return Array.from({ length: 12 }, (_, i) => shiftMonth(`${fiscalYear}-04`, i));
}

/** 暦年（1月〜12月） */
export function monthsOfCalendarYear(year: number): YearMonth[] {
  return Array.from({ length: 12 }, (_, i) => shiftMonth(`${year}-01`, i));
}

/** 指定した月までの直近12か月 */
export function monthsLast12(endMonth: YearMonth): YearMonth[] {
  return Array.from({ length: 12 }, (_, i) => shiftMonth(endMonth, i - 11));
}

/** その月が属する年度（1〜3月は前の年） */
export function fiscalYearOf(month: YearMonth): number {
  const [y, m] = month.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

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
