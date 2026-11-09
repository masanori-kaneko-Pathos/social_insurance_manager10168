/**
 * 休業のカードの値 ⇔ 保存する形（Leave）、産休の期間の候補、育休の延長の上限、届の状態
 * 根拠：産前産後休業取得者申出書/変更（終了）届（2273）、育児休業等取得者申出書（新規・延長）/終了届（2263）
 * Angular・Firebase に依存しない純粋な関数
 */
import { ChildType, emptyLeave, Leave, LeaveKind, Sex } from '../../../core/models/employee';
import { addDays, daysInclusive, toYearMonth } from '../../../shared/utils/date';
import { parseNat } from '../../../shared/utils/number';
import { endOf, isChildcareKind, isExemptKind, oneMonthEnd } from './leave';

export interface LeaveFormValue {
  kind: LeaveKind;
  start: string;
  plannedEnd: string;
  end: string;
  // 産休
  expectedBirthDate: string;
  birthDate: string;
  multipleBirth: boolean;
  // 育休・出生時育休
  childLast: string;
  childFirst: string;
  childLastKana: string;
  childFirstKana: string;
  childBirthDate: string;
  childType: ChildType;
  custodyStart: string;
  papaMamaPlus: boolean;
  workDays: string;
  note: string;
}

export type LeaveField = keyof LeaveFormValue;
export type LeaveError = 'required' | 'order' | 'kana' | 'days' | 'workDaysOver';
export type LeaveWarning =
  | 'beforeMaternityRange' // 産休の開始が「できる範囲」より前
  | 'afterMaternityRange' // 産休の終了予定が範囲より後
  | 'beforeChildcareStart' // 母親の実子の育休が、産後56日のうちに始まっている
  | 'paternityOver28' // 出生時育休が28日を超える
  | 'beyondAge2'; // 育休の終了予定が2歳の前日より後

const KANA = /^[ァ-ヶー・\s　]*$/;
const trimOrNull = (v: string): string | null => (v.trim() ? v.trim() : null);

// ===== 日付の道具 =====

/** n か月後の同じ日（その月にない日は月末に寄せない＝Date に任せる） */
function shiftMonthsDate(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10);
}

// ===== 産休の期間（候補） =====

/**
 * 産休にできる範囲
 * - 産前：基準日（出産日が予定日より早ければ出産日、遅ければ予定日。出産前は予定日）以前42日（多胎98日）
 * - 産後：出産日（出産前は予定日）の後56日
 */
export function maternityRange(
  expectedBirthDate: string | null,
  birthDate: string | null,
  multiple: boolean,
): { from: string; to: string; base: string } | null {
  if (!expectedBirthDate && !birthDate) return null;
  const birth = birthDate ?? expectedBirthDate!;
  const base = expectedBirthDate && birth > expectedBirthDate ? expectedBirthDate : birth;
  return { from: addDays(base, multiple ? -97 : -41), to: addDays(birth, 56), base };
}

// ===== 育休の候補・上限 =====

/** 母親が実子のために取る育休のいちばん早い開始日（子の生年月日の翌日から数えて57日目） */
export function childcareEarliest(
  childBirthDate: string | null,
  childType: ChildType | null,
  sex: Sex | null,
): string | null {
  if (!childBirthDate || childType !== 'natural' || sex !== 'female') return null;
  return addDays(childBirthDate, 57);
}

export type ExtensionKey = 'age1' | 'age1_2' | 'age1_6' | 'age2';

/** 育休の終了予定日の上限（その年齢に達する日＝誕生日の前日）。パパ・ママ育休プラスなら1歳2か月も出す */
export function extensionLimits(childBirthDate: string | null, papaMamaPlus: boolean): { key: ExtensionKey; date: string }[] {
  if (!childBirthDate) return [];
  const at = (months: number) => addDays(shiftMonthsDate(childBirthDate, months), -1);
  const out: { key: ExtensionKey; date: string }[] = [{ key: 'age1', date: at(12) }];
  if (papaMamaPlus) out.push({ key: 'age1_2', date: at(14) });
  out.push({ key: 'age1_6', date: at(18) }, { key: 'age2', date: at(24) });
  return out;
}

/** 月の中で始まって終わる育休か（届書の取得日数・就業予定日数を書く） */
export function isWithinMonth(l: Pick<Leave, 'kind' | 'start' | 'end' | 'plannedEnd'>): boolean {
  const end = endOf(l);
  return isChildcareKind(l.kind) && end !== null && toYearMonth(l.start) === toYearMonth(addDays(end, 1));
}

// ===== 届の状態 =====

export type FilingStatus = 'none' | 'needApply' | 'needChange' | 'needExtension' | 'needEnd' | 'done';

/**
 * 最後に出した届の中身と今の中身を比べて、次に出す届を決める
 * - 産休：出産日がずれた・期間を直した → 変更届、予定より早く終わった → 終了届
 * - 育休：終了予定日を延ばした → 延長、予定より早く終わった → 終了届
 * 介護休業・休職は免除がないので届もない（none）
 */
export function filingStatus(l: Leave): { status: FilingStatus; deadline: string | null } {
  if (!isExemptKind(l.kind)) return { status: 'none', deadline: null };
  const end = endOf(l);
  // 期限：休業中か、終了日から1か月以内（目安）
  const deadline = end ? oneMonthEnd(end) : null;
  const f = l.filed;
  if (!f) return { status: 'needApply', deadline };
  if (l.end && l.end !== f.end && (!f.plannedEnd || l.end < f.plannedEnd)) return { status: 'needEnd', deadline };
  if (l.kind === 'maternity') {
    const bornOffSchedule = !!l.birthDate && l.birthDate !== l.expectedBirthDate && l.birthDate !== f.birthDate;
    const changed =
      f.start !== l.start ||
      f.plannedEnd !== l.plannedEnd ||
      f.expectedBirthDate !== l.expectedBirthDate ||
      f.multipleBirth !== l.multipleBirth;
    return { status: bornOffSchedule || changed ? 'needChange' : 'done', deadline };
  }
  if (f.start !== l.start) return { status: 'needChange', deadline };
  if (l.plannedEnd && f.plannedEnd && l.plannedEnd > f.plannedEnd) return { status: 'needExtension', deadline };
  return { status: 'done', deadline };
}

/** 「届を出した」を押したとき：今の中身を写す */
export function markFiled(l: Leave, today: string): Leave {
  return {
    ...l,
    filed: {
      filedOn: today,
      start: l.start,
      plannedEnd: l.plannedEnd,
      end: l.end,
      expectedBirthDate: l.expectedBirthDate,
      birthDate: l.birthDate,
      multipleBirth: l.multipleBirth,
    },
  };
}

// ===== 画面の値 ⇔ 保存する形 =====

export function emptyLeaveForm(kind: LeaveKind = 'childcare'): LeaveFormValue {
  return toLeaveForm(emptyLeave(kind, ''));
}

export function toLeaveForm(l: Leave): LeaveFormValue {
  return {
    kind: l.kind,
    start: l.start,
    plannedEnd: l.plannedEnd ?? '',
    end: l.end ?? '',
    expectedBirthDate: l.expectedBirthDate ?? '',
    birthDate: l.birthDate ?? '',
    multipleBirth: l.multipleBirth,
    childLast: l.child?.last ?? '',
    childFirst: l.child?.first ?? '',
    childLastKana: l.child?.lastKana ?? '',
    childFirstKana: l.child?.firstKana ?? '',
    childBirthDate: l.childBirthDate ?? '',
    childType: l.childType ?? 'natural',
    custodyStart: l.custodyStart ?? '',
    papaMamaPlus: l.papaMamaPlus,
    workDays: l.workDays == null ? '' : String(l.workDays),
    note: l.note ?? '',
  };
}

export function leaveErrors(v: LeaveFormValue): Partial<Record<LeaveField, LeaveError>> {
  const e: Partial<Record<LeaveField, LeaveError>> = {};
  const exempt = isExemptKind(v.kind);
  if (!v.start) e.start = 'required';
  if (exempt && !v.plannedEnd) e.plannedEnd = 'required';
  if (v.start && v.plannedEnd && v.plannedEnd < v.start) e.plannedEnd = 'order';
  if (v.start && v.end && v.end < v.start) e.end = 'order';
  if (v.kind === 'maternity') {
    if (!v.expectedBirthDate) e.expectedBirthDate = 'required';
  }
  if (isChildcareKind(v.kind)) {
    if (!v.childLast.trim()) e.childLast = 'required';
    if (!KANA.test(v.childLastKana)) e.childLastKana = 'kana';
    if (!KANA.test(v.childFirstKana)) e.childFirstKana = 'kana';
    if (!v.childBirthDate) e.childBirthDate = 'required';
    if (v.childType === 'other' && !v.custodyStart) e.custodyStart = 'required';
    const w = parseNat(v.workDays);
    if (w === undefined) e.workDays = 'days';
    const end = v.end || v.plannedEnd;
    if (w != null && v.start && end && end >= v.start && w > daysInclusive(v.start, end)) e.workDays = 'workDaysOver';
  }
  return e;
}

/** 注意（保存はできる） */
export function leaveWarnings(v: LeaveFormValue, sex: Sex | null): LeaveWarning[] {
  const out: LeaveWarning[] = [];
  if (v.kind === 'maternity') {
    const r = maternityRange(v.expectedBirthDate || null, v.birthDate || null, v.multipleBirth);
    if (r && v.start && v.start < r.from) out.push('beforeMaternityRange');
    if (r && v.plannedEnd && v.plannedEnd > r.to) out.push('afterMaternityRange');
  }
  if (v.kind === 'childcare') {
    const earliest = childcareEarliest(v.childBirthDate || null, v.childType, sex);
    if (earliest && v.start && v.start < earliest) out.push('beforeChildcareStart');
    const limits = extensionLimits(v.childBirthDate || null, v.papaMamaPlus);
    const age2 = limits.find((x) => x.key === 'age2');
    if (age2 && v.plannedEnd && v.plannedEnd > age2.date) out.push('beyondAge2');
  }
  if (v.kind === 'paternity') {
    const end = v.end || v.plannedEnd;
    if (v.start && end && end >= v.start && daysInclusive(v.start, end) > 28) out.push('paternityOver28');
  }
  return out;
}

/**
 * 画面の値を保存する形に。チェックを通らなければ null
 * 種類に関係しない欄は消す。前に出した届の中身（filed）は base から引き継ぐ
 */
export function fromLeaveForm(v: LeaveFormValue, base: Leave | null): Leave | null {
  if (Object.keys(leaveErrors(v)).length > 0) return null;
  const maternity = v.kind === 'maternity';
  const childcare = isChildcareKind(v.kind);
  return {
    kind: v.kind,
    start: v.start,
    plannedEnd: v.plannedEnd || null,
    end: v.end || null,
    expectedBirthDate: maternity ? v.expectedBirthDate || null : null,
    birthDate: maternity ? v.birthDate || null : null,
    multipleBirth: maternity && v.multipleBirth,
    child: childcare
      ? {
          last: v.childLast.trim(),
          first: v.childFirst.trim(),
          lastKana: v.childLastKana.trim(),
          firstKana: v.childFirstKana.trim(),
        }
      : null,
    childBirthDate: childcare ? v.childBirthDate || null : null,
    childType: childcare ? v.childType : null,
    custodyStart: childcare && v.childType === 'other' ? v.custodyStart || null : null,
    papaMamaPlus: v.kind === 'childcare' && v.papaMamaPlus,
    workDays: childcare ? (parseNat(v.workDays) ?? null) : null,
    note: trimOrNull(v.note),
    filed: base?.kind === v.kind ? base.filed : null, // 種類を変えたら届は出し直し
  };
}

/** 期間が重なる休業があるか（終わりの日がなければずっと続くとみなす） */
export function overlaps(l: Leave, others: Leave[]): boolean {
  const e = (x: Leave) => endOf(x) ?? '9999-12-31';
  return others.some((o) => o.start <= e(l) && l.start <= e(o));
}
