// 従業員一覧の並び替えと、加入での絞り込み
// Angular・Firebase に依存しない純粋な関数

import type { Employee } from '../../../core/models/employee';
import type { YearMonth } from '../../../shared/utils/date';
import { coverageForMonth } from './coverage';
import { sortKeyOf } from './name-index';

export const SORT_KEYS = ['name', 'number', 'age', 'hire'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';

export const COVERAGE_FILTERS = ['all', 'health', 'pension', 'care', 'none'] as const;
export type CoverageFilter = (typeof COVERAGE_FILTERS)[number];

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
export function sortEmployees<T extends SortTarget>(list: readonly T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
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
    }
  };
  return [...list].sort((a, b) => cmp(a, b) || byName(a, b));
}

/** 今月の加入状況での絞り込み（年齢による喪失も入れる） */
export function matchesCoverage(
  e: Pick<Employee, 'birthDate' | 'health' | 'pension'>,
  filter: CoverageFilter,
  month: YearMonth,
): boolean {
  if (filter === 'all') return true;
  const c = coverageForMonth(e, month);
  switch (filter) {
    case 'health':
      return c.health;
    case 'pension':
      return c.pension;
    case 'care':
      return c.care;
    case 'none':
      return !c.health && !c.pension;
  }
}
