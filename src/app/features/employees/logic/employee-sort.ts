// 従業員一覧の並び替え（絞り込みは employee-filter.ts）
// Angular・Firebase に依存しない純粋な関数

import type { Employee } from '../../../core/models/employee';
import { sortKeyOf } from './name-index';

// 表の列の順でもある（社員番号 → 氏名 → 部署 → 雇用形態 → 年齢 → 入社日。11/13）
export const SORT_KEYS = ['number', 'name', 'dept', 'employment', 'age', 'hire'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';

type SortTarget = Pick<
  Employee,
  'employeeNumber' | 'birthDate' | 'hireDate' | 'lastName' | 'firstName' | 'lastNameKana' | 'firstNameKana' | 'nameOrder' | 'foreign'
>;

/** 社員番号は数字として比べる（T2 → T10 の順）。番号がない人は最後 */
function compareNumber(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, 'ja', { numeric: true });
}

/**
 * 並び替え（同じ値なら氏名の順）
 * - age：年齢の若い順（＝ 生年月日の新しい順）を「昇順」とする
 * - number：社員番号がない人は、向きに関係なく最後
 */
/**
 * 部署・雇用形態で並べるときの値（呼ぶ側が渡す。空文字 ＝ なし で、向きに関係なく最後）
 * - dept：deptSortKey（読み → あいうえお順、英字 → A〜Z）
 * - employment：選択肢の順の番号
 */
export interface SortContext<T> {
  dept?: (e: T) => string;
  employment?: (e: T) => string;
}

export function sortEmployees<T extends SortTarget>(list: readonly T[], key: SortKey, dir: SortDir, ctx: SortContext<T> = {}): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  const byValue = (get: ((e: T) => string) | undefined, a: T, b: T): number => {
    const x = get?.(a) ?? '';
    const y = get?.(b) ?? '';
    if (!x !== !y) return x ? -1 : 1;
    return sign * x.localeCompare(y, 'ja', { numeric: true });
  };
  const byName = (a: T, b: T) => sortKeyOf(a).key.localeCompare(sortKeyOf(b).key, 'ja');
  const cmp = (a: T, b: T): number => {
    switch (key) {
      case 'name':
        return sign * byName(a, b);
      case 'number': {
        if (!a.employeeNumber || !b.employeeNumber) return compareNumber(a.employeeNumber, b.employeeNumber);
        return sign * compareNumber(a.employeeNumber, b.employeeNumber);
      }
      case 'age':
        return sign * b.birthDate.localeCompare(a.birthDate);
      case 'hire':
        return sign * a.hireDate.localeCompare(b.hireDate);
      case 'dept':
        return byValue(ctx.dept, a, b);
      case 'employment':
        return byValue(ctx.employment, a, b);
    }
  };
  // 同じ部署・同じ雇用形態の中は社員番号の順、そのほかは氏名の順
  const tie = (a: T, b: T) =>
    key === 'dept' || key === 'employment' ? compareNumber(a.employeeNumber, b.employeeNumber) : byName(a, b);
  return [...list].sort((a, b) => cmp(a, b) || tie(a, b));
}
