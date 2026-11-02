import { Enrollment } from '../../../core/models/employee';
import { addDays, formatYmd, monthOf, parseYmd } from '../../../shared/utils/date';

export interface CoverageInput {
  birthDate: string;
  health: Enrollment;
  pension: Enrollment;
}

export interface MonthlyCoverage {
  month: string; // 'YYYY-MM'
  health: boolean;
  care: boolean;
  pension: boolean;
}

/** その年齢の誕生日（2/29生まれは平年だと Date が自動で 3/1 にする） */
export function birthdayAt(birthDate: string, age: number): string {
  const b = parseYmd(birthDate);
  return formatYmd(new Date(Date.UTC(b.getUTCFullYear() + age, b.getUTCMonth(), b.getUTCDate())));
}

/** 年齢到達日：法律上、年齢は誕生日の前日に1つ増える */
export function ageReachDate(birthDate: string, age: number): string {
  return addDays(birthdayAt(birthDate, age), -1);
}

/** 退職日 → 資格喪失日（翌日） */
export function lostDateFromRetire(retireDate: string): string {
  return addDays(retireDate, 1);
}

/** 保険料がかかる月か：取得月 ≦ 月 ＜ 喪失月（同じ月に取得・喪失なら、その月だけ） */
function chargedIn(month: string, acquired: string, lost: string | null): boolean {
  const a = monthOf(acquired);
  if (month < a) return false;
  if (lost === null) return true;
  const l = monthOf(lost);
  if (a === l) return month === a;
  return month < l;
}

/** 早いほうの日付（null は「まだ喪失していない」） */
function earlier(a: string | null, b: string): string {
  return a === null || b < a ? b : a;
}

/** ある月に、どの保険の保険料がかかるか */
export function coverageForMonth(input: CoverageInput, month: string): MonthlyCoverage {
  const { birthDate, health, pension } = input;

  // 健康保険：75歳の誕生日当日に後期高齢者医療へ（その日を喪失日とみなす）
  const healthOn =
    health.enrolled &&
    health.acquiredDate !== null &&
    chargedIn(month, health.acquiredDate, earlier(health.lostDate, birthdayAt(birthDate, 75)));

  // 厚生年金：70歳到達日（誕生日の前日）に喪失
  const pensionOn =
    pension.enrolled &&
    pension.acquiredDate !== null &&
    chargedIn(month, pension.acquiredDate, earlier(pension.lostDate, ageReachDate(birthDate, 70)));

  // 介護保険：健康保険の加入中で、40歳到達月 〜 65歳到達月の前月
  const careOn =
    healthOn &&
    month >= monthOf(ageReachDate(birthDate, 40)) &&
    month < monthOf(ageReachDate(birthDate, 65));

  return { month, health: healthOn, care: careOn, pension: pensionOn };
}

/** 複数の月をまとめて判定 */
export function coverageForMonths(input: CoverageInput, months: string[]): MonthlyCoverage[] {
  return months.map((m) => coverageForMonth(input, m));
}

/** 年度の12か月（例：2026年度 → 2026-04 〜 2027-03） */
export function fiscalYearMonths(fiscalYear: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1; // 4,5,…,12,1,2,3
    const y = m >= 4 ? fiscalYear : fiscalYear + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  });
}

/** 暦年の12か月（例：2026年 → 2026-01 〜 2026-12） */
export function calendarYearMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}