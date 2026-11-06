/**
 * 日付・年月の道具（Angular・Firebase に依存しない）
 * 日付は 'YYYY-MM-DD'、年月は 'YYYY-MM' の文字列で扱う（文字列のまま大小比較できる）。
 * タイムゾーンの影響を受けないよう、計算は UTC で行う。
 */

export type DateStr = string; // 'YYYY-MM-DD'
export type YearMonth = string; // 'YYYY-MM'

export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const DAY_MS = 86_400_000;
const pad2 = (n: number) => String(n).padStart(2, '0');

function toUtc(date: DateStr): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): DateStr {
  return new Date(ms).toISOString().slice(0, 10);
}

// ===== 今日 =====

/** 端末の現地時間での今日（'YYYY-MM-DD'） */
export function todayLocal(now: Date = new Date()): DateStr {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

// ===== 日付 =====

/** 年・月・日から日付を作る（はみ出した日は次の月へ繰り上がる。例：2/29 の平年 → 3/1） */
export function dateOf(year: number, month: number, day: number): DateStr {
  return fromUtc(Date.UTC(year, month - 1, day));
}

export function addDays(date: DateStr, days: number): DateStr {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** a〜b の日数（両端を含む） */
export function daysInclusive(a: DateStr, b: DateStr): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS) + 1;
}

export function toYearMonth(date: DateStr): YearMonth {
  return date.slice(0, 7);
}

/** 表示用の満年齢（誕生日に1つ増える一般的な数え方） */
export function ageAt(birthDate: DateStr, onDate: DateStr): number {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [y, m, d] = onDate.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

// ===== 年月 =====

export function shiftMonth(month: YearMonth, diff: number): YearMonth {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + diff;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${pad2((total % 12) + 1)}`;
}

/** その月の日数（28〜31） */
export function daysInMonth(month: YearMonth): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** from〜to の月（両端を含む。from > to なら空） */
export function monthsBetween(from: YearMonth, to: YearMonth): YearMonth[] {
  const out: YearMonth[] = [];
  for (let m = from; m <= to; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** 年度（4月〜翌3月） */
export function monthsOfFiscalYear(fiscalYear: number): YearMonth[] {
  return monthsBetween(`${fiscalYear}-04`, `${fiscalYear + 1}-03`);
}

/** 暦年（1月〜12月） */
export function monthsOfCalendarYear(year: number): YearMonth[] {
  return monthsBetween(`${year}-01`, `${year}-12`);
}

/** 指定した月までの直近12か月 */
export function monthsLast12(endMonth: YearMonth): YearMonth[] {
  return monthsBetween(shiftMonth(endMonth, -11), endMonth);
}

/** その月が属する年度（1〜3月は前の年） */
export function fiscalYearOf(month: YearMonth): number {
  const [y, m] = month.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}
