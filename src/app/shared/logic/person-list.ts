// 人の並ぶ表（給与の入力・賞与の登録）の、探す・絞る・並べる・ページに分ける（11/12）
// Angular・Firebase に依存しない純粋な関数
//
// 1000人を縦に並べると、だれに入れるのかが探せない。従業員の一覧と同じ考え方で、
// 名前・社員番号で探す → 従業員の一覧と同じ条件で絞る → 見出しで並べる → 100・200・500人ずつ見せる（11/13）

import type { EmploymentType, PayType } from '../../core/models/contract';
import type { Employee } from '../../core/models/employee';
import { activeCount, emptyFilter, EmployeeFilter, matchesFilter } from '../../features/employees/logic/employee-filter';
import { todayLocal, toYearMonth } from '../utils/date';

export type PersonSort = 'kana' | 'number' | 'hire';
export const PERSON_SORTS: readonly PersonSort[] = ['kana', 'number', 'hire'];
export type EntryState = 'all' | 'empty' | 'filled';
export const ENTRY_STATES: readonly EntryState[] = ['all', 'empty', 'filled'];

/** 1ページの人数（選べる大きさ。初期値は100人。11/13） */
export const PAGE_SIZES = [100, 200, 500] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const PAGE_SIZE: PageSize = 100;

export type SortDirection = 'asc' | 'desc';

/** 表に並ぶ人（従業員の一覧と同じ絞り込みに使う項目も含む） */
export type PersonLike = Pick<
  Employee,
  | 'employeeNumber'
  | 'lastName'
  | 'firstName'
  | 'lastNameKana'
  | 'firstNameKana'
  | 'hireDate'
  | 'birthDate'
  | 'health'
  | 'pension'
  | 'sex'
  | 'foreign'
>;

export interface PersonListOptions {
  /** 名前・フリガナ・社員番号の一部（空なら全員） */
  query: string;
  employment: EmploymentType | 'all';
  payType: PayType | 'all';
  /** 入れたかどうか（給与・賞与の額が入っているか） */
  entry: EntryState;
  sort: PersonSort;
  /** 並びの向き（見出しをもう一度押すと逆） */
  dir: SortDirection;
  /** 従業員の一覧と同じ条件（加入・入社日・年齢・性別・国籍） */
  filter: EmployeeFilter;
  /** 1ページの人数 */
  size: PageSize;
}

export function defaultListOptions(): PersonListOptions {
  return {
    query: '',
    employment: 'all',
    payType: 'all',
    entry: 'all',
    sort: 'kana',
    dir: 'asc',
    filter: emptyFilter(),
    size: PAGE_SIZE,
  };
}

/** 使っている絞り込みの数（「絞り込み」ボタンに出す。探す・並びは数えない） */
export function listFilterCount(o: PersonListOptions): number {
  return (
    activeCount(o.filter) +
    (o.employment !== 'all' ? 1 : 0) +
    (o.payType !== 'all' ? 1 : 0) +
    (o.entry !== 'all' ? 1 : 0)
  );
}

/** 比べるためにそろえる（全角半角・カタカナひらがな・大文字小文字・空白） */
export function searchKey(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/\s+/g, '');
}

export function matchesQuery(p: PersonLike, query: string): boolean {
  const q = searchKey(query);
  if (!q) return true;
  const hay = searchKey(
    [p.lastName, p.firstName, p.lastName + p.firstName, p.lastNameKana + p.firstNameKana, p.employeeNumber ?? ''].join('|'),
  );
  return hay.includes(q);
}

/**
 * 絞って並べる
 * - getPerson：行から人
 * - getContract：行から、その月に効いている契約の雇用形態・給与の形（契約がなければ null）
 * - isFilled：行に額が入っているか
 */
export function filterAndSort<T>(
  rows: readonly T[],
  opts: PersonListOptions,
  getPerson: (r: T) => PersonLike,
  getContract: (r: T) => { employmentType: EmploymentType; payType: PayType } | null,
  isFilled: (r: T) => boolean,
): T[] {
  const today = todayLocal();
  const ctx = { today, month: toYearMonth(today) };
  const useFilter = activeCount(opts.filter) > 0;
  const out = rows.filter((r) => {
    const p = getPerson(r);
    if (!matchesQuery(p, opts.query)) return false;
    if (useFilter && !matchesFilter(p, opts.filter, ctx)) return false;
    const c = getContract(r);
    if (opts.employment !== 'all' && c?.employmentType !== opts.employment) return false;
    if (opts.payType !== 'all' && c?.payType !== opts.payType) return false;
    if (opts.entry === 'empty' && isFilled(r)) return false;
    if (opts.entry === 'filled' && !isFilled(r)) return false;
    return true;
  });
  const kana = (p: PersonLike) => p.lastNameKana + p.firstNameKana;
  const cmp: Record<PersonSort, (a: PersonLike, b: PersonLike) => number> = {
    kana: (a, b) => kana(a).localeCompare(kana(b), 'ja'),
    number: (a, b) =>
      (a.employeeNumber ?? '￿').localeCompare(b.employeeNumber ?? '￿', 'ja', { numeric: true }) ||
      kana(a).localeCompare(kana(b), 'ja'),
    hire: (a, b) => a.hireDate.localeCompare(b.hireDate) || kana(a).localeCompare(kana(b), 'ja'),
  };
  const sign = opts.dir === 'desc' ? -1 : 1;
  return [...out].sort((a, b) => sign * cmp[opts.sort](getPerson(a), getPerson(b)));
}

/** ページの数（0人でも1ページ） */
export function pageCount(total: number, size: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** そのページの行（ページは1から。はみ出したら最後のページ） */
export function pageOf<T>(rows: readonly T[], page: number, size: number = PAGE_SIZE): { rows: T[]; page: number; pages: number } {
  const pages = pageCount(rows.length, size);
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages };
}
