// To-do の追加分：外国籍の人の在留・資格外活動・脱退一時金と、特定適用事業所の人数
// Angular・Firebase に依存しない純粋な関数。結果は保存せず、開くたびに計算する
//
// - residence：在留期間の満了日が60日以内（過ぎていて在籍中も）→ 在留カードの確認（更新の許可が出たか）
// - workPermit：資格外活動の許可の時間（週28時間など）を、今の契約の週の所定労働時間が超えている
// - lumpSum：外国籍で厚生年金に6か月以上入っていた人の退職（前後60日）→ 脱退一時金の案内
//   （請求は本人が出国後2年以内に日本年金機構へ。会社の届ではないので「案内した」で消せる）
// - specificOffice：特定適用事業所でないのに、今月の人数（厚生年金の被保険者の数え方）が基準以上
//   （直近12か月のうち6か月以上で基準を超えると該当。ここでは今月の人数で知らせる）
// - myNumberCheck：本人が提出したマイナンバーのチェック待ち（管理者だけ）
// - myNumberDispose：資格喪失から2年たった人のマイナンバー（廃棄する。ガイドライン「保管制限と廃棄」）

import { addDays, DateStr, monthsBetween, shiftMonth, toYearMonth, YearMonth } from '../../../shared/utils/date';
import { contractAt } from '../../employees/logic/contract-form-model';
import type { MyNumberEntry } from '../../../core/models/my-number';
import { disposalDue, DisposalPerson } from '../../my-number/logic/my-number';
import { countHeadcount, criteriaAt, HeadcountTarget, isSpecificApplied, WorkSchedule } from '../../employees/logic/coverage';

export type ExtraKind = 'residence' | 'workPermit' | 'lumpSum' | 'specificOffice' | 'myNumberCheck' | 'myNumberDispose';

export interface ExtraTodo {
  kind: ExtraKind;
  employeeId: string | null;
  /** residence：満了日／workPermit：今の契約の始まる日／lumpSum：退職日 */
  date: DateStr | null;
  /** 文の差し込み（時間・人数など） */
  params: Record<string, string | number>;
}

export const RESIDENCE_DAYS = 60;
export const LUMP_SUM_DAYS = 60;
/** 脱退一時金：厚生年金の加入期間がこの月数以上 */
export const LUMP_SUM_MIN_MONTHS = 6;

export interface ExtraPerson {
  id: string;
  retireDate: DateStr | null;
  pension: { enrolled: boolean; acquiredDate: DateStr | null; lostDate: DateStr | null };
  foreign: {
    residenceExpiry: DateStr | null;
    workPermit: boolean;
    workPermitWeeklyMinutes: number | null;
  } | null;
}

const active = (p: Pick<ExtraPerson, 'retireDate'>, today: DateStr) => !p.retireDate || p.retireDate >= today;
const hours = (m: number) => Math.round((m / 60) * 10) / 10;

/** 在留期間の満了日が60日以内（過ぎていても在籍中なら出す） */
export function residenceTodo(p: ExtraPerson, today: DateStr, days = RESIDENCE_DAYS): ExtraTodo | null {
  const exp = p.foreign?.residenceExpiry;
  if (!exp || !active(p, today) || exp > addDays(today, days)) return null;
  return { kind: 'residence', employeeId: p.id, date: exp, params: { date: exp } };
}

/** 資格外活動：今の契約の週の時間が、許可の時間を超える */
export function workPermitTodo(
  p: ExtraPerson,
  contracts: (Pick<WorkSchedule, 'weeklyMinutes'> & { from: DateStr })[],
  today: DateStr,
): ExtraTodo | null {
  const f = p.foreign;
  if (!f?.workPermit || f.workPermitWeeklyMinutes == null || !active(p, today)) return null;
  const c = contractAt(contracts, today);
  if (!c || c.weeklyMinutes <= f.workPermitWeeklyMinutes) return null;
  return {
    kind: 'workPermit',
    employeeId: p.id,
    date: c.from,
    params: { hours: hours(c.weeklyMinutes), limit: hours(f.workPermitWeeklyMinutes) },
  };
}

/**
 * 厚生年金の被保険者期間の月数（資格を取った月 〜 喪失した月の前月。保険料を納める月と同じ数え方）
 * 喪失日がまだ入っていなければ、退職日の翌日を喪失日とみなす
 */
export function pensionMonths(p: ExtraPerson): number {
  const from = p.pension.acquiredDate;
  const lost = p.pension.lostDate ?? (p.retireDate ? addDays(p.retireDate, 1) : null);
  if (!from || !lost || lost <= from) return 0;
  return monthsBetween(toYearMonth(from), shiftMonth(toYearMonth(lost), -1)).length;
}

/** 外国籍で厚生年金に6か月以上入っていた人の退職（退職日の前後60日） */
export function lumpSumTodo(p: ExtraPerson, today: DateStr, days = LUMP_SUM_DAYS): ExtraTodo | null {
  if (!p.foreign || !p.retireDate || !p.pension.enrolled) return null;
  if (p.retireDate < addDays(today, -days) || p.retireDate > addDays(today, days)) return null;
  const months = pensionMonths(p);
  if (months < LUMP_SUM_MIN_MONTHS) return null;
  return { kind: 'lumpSum', employeeId: p.id, date: p.retireDate, params: { months } };
}

/** 特定適用事業所でないのに、今月の人数が基準以上 */
export function specificOfficeTodo(
  office: {
    standardHours: WorkSchedule | null;
    specificApplication?: { since: string | null; insuredCount?: number | null } | null;
  },
  people: HeadcountTarget[],
  criteria: { from: YearMonth; sizeMin: number | null }[],
  month: YearMonth,
): ExtraTodo | null {
  if (isSpecificApplied(office.specificApplication, month)) return null;
  const sizeMin = criteriaAt(criteria, month)?.sizeMin;
  if (sizeMin == null) return null; // 規模の要件がない（なくなった）
  const manual = office.specificApplication?.insuredCount;
  const count = manual ?? countHeadcount(people, office.standardHours, month)?.counted;
  if (count == null || count < sizeMin) return null;
  return {
    kind: 'specificOffice',
    employeeId: null,
    date: null,
    params: { count, min: sizeMin, how: manual != null ? 'manual' : 'app' },
  };
}

/** マイナンバー：チェック待ち・廃棄の時期（状態の一覧は管理者だけが読める） */
export function myNumberTodos(
  people: readonly DisposalPerson[],
  index: ReadonlyMap<string, MyNumberEntry>,
  today: DateStr,
): ExtraTodo[] {
  const out: ExtraTodo[] = [];
  for (const p of people) {
    const e = index.get(p.id) ?? null;
    if (e?.status === 'submitted') {
      out.push({ kind: 'myNumberCheck', employeeId: p.id, date: e.updatedAt.slice(0, 10) || null, params: {} });
    }
    const due = disposalDue(p, e, today);
    if (due) out.push({ kind: 'myNumberDispose', employeeId: p.id, date: due, params: { date: due } });
  }
  return out;
}
