// 給与の支払区分（11/24）
// Angular・Firebase に依存しない純粋な関数
//
// 月給者とパートなど、締め日・支払日・支払月・控除の時期が違う人を、1つの事業所で扱う
// - 事業所の payroll ＝ 既定の区分。2つ目からの区分は payGroups
// - 従業員には「何月払いの給与から、どの区分か」を履歴で割り当てる（なし ＝ 既定の区分）
// - 計算（対象期間・給与計算の基礎日数・控除する給与の月・定時決定・随時改定・取り込みのチェック）は、その人のその月の区分で行う
// - 控除の時期の履歴（deductionHistory）は既定の区分のもの。ほかの区分は、区分の設定の控除の時期だけを使う

import type { PayGroupAssignment } from '../../../core/models/employee';
import type { DeductionPeriod, PayGroup, PayrollSettings } from '../../../core/models/office';
import { DEFAULT_PAYROLL } from '../office-settings';

export interface PayGroupOffice {
  payroll?: PayrollSettings | null;
  payGroups?: readonly PayGroup[] | null;
  deductionHistory?: readonly DeductionPeriod[] | null;
}

export interface PayGroupHolder {
  payGroups?: readonly PayGroupAssignment[] | null;
}

/** 1つの事業所に持てる区分の数（既定を除く。ルールと同じ） */
export const MAX_PAY_GROUPS = 10;

/** その支払月に割り当てられている区分の ID（既定の区分なら null） */
export function payGroupIdAt(e: PayGroupHolder | null | undefined, paidMonth: string): string | null {
  let hit: PayGroupAssignment | null = null;
  for (const a of e?.payGroups ?? []) if (a.from <= paidMonth && (!hit || a.from >= hit.from)) hit = a;
  return hit?.groupId ?? null;
}

/** その人のその支払月の区分（既定の区分・消した区分なら null） */
export function payGroupAt(office: PayGroupOffice, e: PayGroupHolder | null | undefined, paidMonth: string): PayGroup | null {
  const id = payGroupIdAt(e, paidMonth);
  return id ? (office.payGroups ?? []).find((g) => g.id === id) ?? null : null;
}

/** その人のその支払月の給与の決まり（締め日・支払日・支払月・控除の時期） */
export function payrollAt(office: PayGroupOffice, e: PayGroupHolder | null | undefined, paidMonth: string): PayrollSettings {
  const g = payGroupAt(office, e, paidMonth);
  return g ? { ...DEFAULT_PAYROLL, ...g.payroll } : { ...DEFAULT_PAYROLL, ...(office.payroll ?? {}) };
}

/** 控除の時期の履歴（既定の区分の人だけ。ほかの区分は区分の設定のまま） */
export function deductionHistoryAt(
  office: PayGroupOffice,
  e: PayGroupHolder | null | undefined,
  paidMonth: string,
): readonly DeductionPeriod[] | null {
  return payGroupAt(office, e, paidMonth) ? null : (office.deductionHistory ?? null);
}

/** 区分が2つ以上あるか（1つだけの事業所では、区分の欄・札を出さない） */
export function hasPayGroups(office: PayGroupOffice): boolean {
  return (office.payGroups ?? []).length > 0;
}

/** 割り当てが、消した区分を指しているか（既定の区分で計算しているので知らせる） */
export function missingGroup(office: PayGroupOffice, e: PayGroupHolder | null | undefined, paidMonth: string): boolean {
  const id = payGroupIdAt(e, paidMonth);
  return !!id && !(office.payGroups ?? []).some((g) => g.id === id);
}

export type PayGroupError = 'name' | 'duplicate' | 'closingDay' | 'payDay' | 'tooMany';

/** 区分の一覧のチェック（名前は必須・重ならない。日は1〜31。31 ＝ 末日） */
export function payGroupErrors(groups: readonly PayGroup[], defaultName: string): Map<number, PayGroupError[]> {
  const out = new Map<number, PayGroupError[]>();
  const names = new Map<string, number>();
  groups.forEach((g, i) => {
    const errs: PayGroupError[] = [];
    const n = g.name.trim();
    if (!n || n.length > 30) errs.push('name');
    else if (n === defaultName || names.has(n)) errs.push('duplicate');
    names.set(n, i);
    const day = (d: number) => Number.isInteger(d) && d >= 1 && d <= 31;
    if (!day(g.payroll.closingDay)) errs.push('closingDay');
    if (!day(g.payroll.payDay)) errs.push('payDay');
    if (i >= MAX_PAY_GROUPS) errs.push('tooMany');
    if (errs.length > 0) out.set(i, errs);
  });
  return out;
}

/** 新しい区分の ID（今ある ID と重ならない短い英数字） */
export function newPayGroupId(groups: readonly PayGroup[]): string {
  for (let i = 1; ; i++) {
    const id = `g${i}`;
    if (!groups.some((g) => g.id === id)) return id;
  }
}

/**
 * 割り当てを変える：その支払月から、その区分にする（同じ月の割り当ては置き換え、後ろの月の割り当ては残す）
 * groupId が null ＝ 既定の区分に戻す。前の月と同じ区分になるなら足さない
 */
export function withAssignment(list: readonly PayGroupAssignment[] | null | undefined, from: string, groupId: string | null): PayGroupAssignment[] {
  const rest = (list ?? []).filter((a) => a.from !== from);
  const before = payGroupIdAt({ payGroups: rest }, from);
  const next = before === groupId ? rest : [...rest, { from, groupId }];
  return next.sort((a, b) => a.from.localeCompare(b.from));
}
