// 部署の一覧（事業所の設定）：足す・名前を変える・消す
// Angular・Firebase に依存しない純粋な関数
// id は名前を変えても変わらない（従業員の org.departmentId が指す）

import type { Department } from '../../../core/models/office';
import { toKatakana } from '../../../shared/utils/text';

export const MAX_DEPARTMENTS = 50;
export const MAX_DEPARTMENT_NAME = 40;

export type DepartmentError = 'empty' | 'tooLong' | 'duplicate' | 'tooMany';

/** 次の id（d1, d2 …。消した番号は使い直さない） */
export function nextDepartmentId(list: readonly Department[]): string {
  const max = list.reduce((m, d) => Math.max(m, Number(/^d(\d+)$/.exec(d.id)?.[1] ?? 0)), 0);
  return `d${max + 1}`;
}

/** 名前のチェック（exceptId は名前を変える部署自身） */
export function departmentError(list: readonly Department[], name: string, exceptId: string | null = null): DepartmentError | null {
  const n = name.trim();
  if (!n) return 'empty';
  if (n.length > MAX_DEPARTMENT_NAME) return 'tooLong';
  if (list.some((d) => d.id !== exceptId && d.name.trim() === n)) return 'duplicate';
  if (exceptId === null && list.length >= MAX_DEPARTMENTS) return 'tooMany';
  return null;
}

/** 読み（空なら null。ひらがなはカタカナにそろえる） */
function kanaOf(kana: string | null | undefined): string | null {
  const k = toKatakana((kana ?? '').normalize('NFKC').trim());
  return k ? k : null;
}

export function addDepartment(list: readonly Department[], name: string, kana: string | null = null): Department[] {
  return [...list, { id: nextDepartmentId(list), name: name.trim(), kana: kanaOf(kana) }];
}

export function renameDepartment(list: readonly Department[], id: string, name: string, kana: string | null = null): Department[] {
  return list.map((d) => (d.id === id ? { ...d, name: name.trim(), kana: kanaOf(kana) } : d));
}

export function removeDepartment(list: readonly Department[], id: string): Department[] {
  return list.filter((d) => d.id !== id);
}
