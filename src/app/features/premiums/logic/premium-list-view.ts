// 保険料一覧の見せ方（並べ替え・標準報酬の出し方）
// Angular・Firebase に依存しない純粋な関数

import type { Employee } from '../../../core/models/employee';
import { sortEmployees } from '../../employees/logic/employee-sort';
import type { RowState } from './premium-rows';

/** 見出しを押して並べ替えられる列 */
export const PREMIUM_SORT_KEYS = ['number', 'name', 'employee', 'employer'] as const;
export type PremiumSortKey = (typeof PREMIUM_SORT_KEYS)[number];
export type PremiumSortDir = 'asc' | 'desc';
export interface PremiumSort {
  key: PremiumSortKey;
  dir: PremiumSortDir;
}

export const DEFAULT_PREMIUM_SORT: PremiumSort = { key: 'number', dir: 'asc' };

/**
 * 見出しを押したときの次の並び
 * - 同じ列：向きを反対に
 * - 別の列：社員番号・氏名は小さい順、金額は大きい順から（金額は「誰が多いか」を見たいことが多い）
 */
export function nextSort(cur: PremiumSort, key: PremiumSortKey): PremiumSort {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'number' || key === 'name' ? 'asc' : 'desc' };
}

type SortEmployee = Parameters<typeof sortEmployees>[0][number] & Pick<Employee, 'id'>;

export interface SortableRow {
  employee: SortEmployee;
  state: RowState;
  result: { employeeYen: number } | null;
  premiumEmployerMilli: number;
}

/** 直してほしい行（標準報酬が未登録・計算エラー） */
export function isProblem(r: Pick<SortableRow, 'state'>): boolean {
  return r.state === 'missing' || r.state === 'error';
}

/**
 * 並べ替え
 * - 直してほしい行は、どの列で並べても上に固定（埋もれないように）
 * - 金額が同じ人・金額のない人（免除）は、社員番号の順
 */
export function sortPremiumRows<T extends SortableRow>(rows: readonly T[], sort: PremiumSort): T[] {
  const byName = sort.key === 'name';
  const nameOrNumber = byName || sort.key === 'number';
  const ordered = sortEmployees(
    rows.map((r) => r.employee),
    byName ? 'name' : 'number',
    nameOrNumber ? sort.dir : 'asc',
  );
  const rank = new Map(ordered.map((e, i) => [e.id, i]));
  const rankOf = (r: T) => rank.get(r.employee.id) ?? 0;
  const amount = (r: T): number => {
    if (r.state !== 'ok') return 0;
    return sort.key === 'employee' ? (r.result?.employeeYen ?? 0) * 1000 : r.premiumEmployerMilli;
  };
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const p = Number(isProblem(b)) - Number(isProblem(a));
    if (p !== 0) return p;
    if (!nameOrNumber) {
      const d = sign * (amount(a) - amount(b));
      if (d !== 0) return d;
    }
    return rankOf(a) - rankOf(b);
  });
}

/**
 * 標準報酬月額の出し方
 * - 健保と厚年が同じ（ほとんどの人）：1つだけ
 * - 違う（上限・下限の近く）：健保・厚年を2段で
 * - 片方だけ（70歳以上は厚年なし など）：その1つ
 */
export type StandardView =
  | { kind: 'one'; yen: number }
  | { kind: 'split'; health: number; pension: number }
  | null;

export function standardView(
  health: { standard: number } | null,
  pension: { standard: number } | null,
): StandardView {
  if (health && pension) {
    return health.standard === pension.standard
      ? { kind: 'one', yen: health.standard }
      : { kind: 'split', health: health.standard, pension: pension.standard };
  }
  const only = health ?? pension;
  return only ? { kind: 'one', yen: only.standard } : null;
}
