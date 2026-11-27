// 特定被保険者（組合健保だけ。11/26）
// Angular・Firebase に依存しない純粋な関数
//
// 規約で定めた健康保険組合は、介護保険の第2号被保険者でない被保険者（40歳未満・65歳以上）でも、
// 40〜64歳の被扶養者（＝介護保険の第2号被保険者）がいれば、介護保険料を取ることができる（介護保険法附則・健康保険法附則第7条）。
// 協会けんぽにはこの制度がない。採用しているかは組合の規約で決まるので、事業所の健康保険の設定で人が選ぶ。
//
// 月ごとの判定（成功例Bの設計と同じ数え方。組合の規約が違えば、その組合は対象外として扱う）
// - 被扶養者は、扶養に入った日の月から、外れた日の月の前月まで数える（外れた日の月からは数えない）
// - 被扶養者の年齢：40歳到達（誕生日の前日）の月 〜 65歳到達の月の前月（被保険者本人と同じ）
// - 海外特例で国外に住んでいる期間は、介護保険の第2号被保険者ではないので数えない
//   （該当した日の月から、該当しなくなった日の月の前月まで外す。本人の介護保険の適用除外と同じ数え方）
// - 本人が40〜64歳の月は、ふつうの介護保険料がかかるので特定被保険者ではない
// - 料率・負担割合は、その組合の介護保険料率をそのまま使う

import { ageReachDate } from './coverage';
import { toYearMonth, YearMonth } from '../../../shared/utils/date';

export interface CareDependentLike {
  birthDate: string;
  from: string;
  to: string | null;
  overseas?: { from: string; to: string | null } | null;
}

/** 40歳到達の月 〜 65歳到達の月の前月か */
function inCareAge(birthDate: string, month: YearMonth): boolean {
  return month >= toYearMonth(ageReachDate(birthDate, 40)) && month < toYearMonth(ageReachDate(birthDate, 65));
}

/** その月に、介護保険の第2号被保険者として数える被扶養者か */
export function careDependentIn(d: CareDependentLike, month: YearMonth): boolean {
  if (!d.birthDate || !d.from) return false;
  if (month < toYearMonth(d.from)) return false;
  if (d.to && month >= toYearMonth(d.to)) return false;
  const o = d.overseas;
  if (o?.from && month >= toYearMonth(o.from) && (!o.to || month < toYearMonth(o.to))) return false;
  return inCareAge(d.birthDate, month);
}

/** その月に、介護保険の第2号被保険者として数える被扶養者（特定被保険者の理由を画面に出すため。11/27） */
export function careDependentsIn<T extends CareDependentLike>(dependents: readonly T[], month: YearMonth): T[] {
  return dependents.filter((d) => careDependentIn(d, month));
}

/**
 * その月、特定被保険者として介護保険料がかかるか
 * enabled：その月の保険者が、特定被保険者の制度を採用している組合か（事業所の保険者の履歴から）
 */
export function specialInsuredIn(
  insuredBirthDate: string,
  dependents: readonly CareDependentLike[],
  month: YearMonth,
  enabled: boolean,
): boolean {
  if (!enabled || inCareAge(insuredBirthDate, month)) return false;
  return dependents.some((d) => careDependentIn(d, month));
}

/** 保険者の履歴の1行（その月から） */
export interface SpecialInsurerPeriod {
  from: string;
  healthInsurer: { type: string; specialInsured?: boolean | null };
}

/** その月の保険者が、特定被保険者の制度を採用している組合か（履歴より前の月は false） */
export function specialEnabledAt(history: readonly SpecialInsurerPeriod[], month: YearMonth): boolean {
  let found: SpecialInsurerPeriod | null = null;
  for (const p of history) if (p.from <= month && (!found || p.from > found.from)) found = p;
  return !!found && found.healthInsurer.type === 'kumiai' && found.healthInsurer.specialInsured === true;
}

/** 履歴のどこかで、特定被保険者の制度を採用しているか（扶養家族を読むかどうかを決める） */
export function usesSpecialInsured(history: readonly SpecialInsurerPeriod[]): boolean {
  return history.some((p) => p.healthInsurer.type === 'kumiai' && p.healthInsurer.specialInsured === true);
}

/** 1人分の「月 → 特定被保険者か」 */
export function specialInsuredFor(
  history: readonly SpecialInsurerPeriod[],
  insuredBirthDate: string,
  dependents: readonly CareDependentLike[],
): (month: YearMonth) => boolean {
  return (month) => specialInsuredIn(insuredBirthDate, dependents, month, specialEnabledAt(history, month));
}
