/**
 * 年齢到達の検知（ダッシュボードの一覧に使う）
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 */
import {
  ageReachDate,
  birthdayAt,
  CoverageInput,
  DateStr,
  toYearMonth,
  YearMonth,
} from './coverage';

/** 知らせる年齢 */
export type AgeMilestone = 40 | 60 | 65 | 70 | 75;
export const AGE_MILESTONES: AgeMilestone[] = [40, 60, 65, 70, 75];

export interface AgeEvent {
  age: AgeMilestone;
  birthday: DateStr; // その年齢の誕生日
  reachDate: DateStr; // 法律上の到達日（誕生日の前日）
  /** 保険料などに影響が出る月（75歳は誕生日の月、それ以外は到達日の月） */
  effectMonth: YearMonth;
}

export interface AgeTarget extends CoverageInput {
  retireDate: DateStr | null;
}

/** 在籍中か（退職日が今日より前なら退職済み） */
export function isActive(e: AgeTarget, today: DateStr): boolean {
  return !e.retireDate || e.retireDate >= today;
}

/** その年齢がその人に関係するか（加入している保険で決める） */
function relevant(e: AgeTarget, age: AgeMilestone): boolean {
  if (age === 60) return true; // 定年・再雇用の確認（保険の資格に関係なく出す）
  if (age === 70) return e.pension.enrolled; // 厚年の喪失
  return e.health.enrolled; // 40・65（介護）、75（健保の喪失）
}

export function ageEventOf(birthDate: DateStr, age: AgeMilestone): AgeEvent {
  const birthday = birthdayAt(birthDate, age);
  const reachDate = ageReachDate(birthDate, age);
  return {
    age,
    birthday,
    reachDate,
    effectMonth: toYearMonth(age === 75 ? birthday : reachDate),
  };
}

/**
 * from〜to の月に、誕生日か影響が出る月のどちらかが入る年齢到達
 * （1日生まれは影響が誕生日の前の月に出るので、どちらかで拾う）
 */
export function ageEventsIn(
  e: AgeTarget,
  from: YearMonth,
  to: YearMonth,
  ages: AgeMilestone[] = AGE_MILESTONES,
): AgeEvent[] {
  const inRange = (m: YearMonth) => m >= from && m <= to;
  return ages
    .filter((age) => relevant(e, age))
    .map((age) => ageEventOf(e.birthDate, age))
    .filter((ev) => inRange(toYearMonth(ev.birthday)) || inRange(ev.effectMonth));
}

export type AgeSort = 'birthday' | 'effect';

/** 並べる月（誕生日順なら誕生日の月、影響順なら影響が出る月） */
export function sortMonthOf(ev: AgeEvent, sort: AgeSort): YearMonth {
  return sort === 'birthday' ? toYearMonth(ev.birthday) : ev.effectMonth;
}

export function compareAgeEvents(a: AgeEvent, b: AgeEvent, sort: AgeSort): number {
  return (
    sortMonthOf(a, sort).localeCompare(sortMonthOf(b, sort)) ||
    a.birthday.localeCompare(b.birthday)
  );
}
