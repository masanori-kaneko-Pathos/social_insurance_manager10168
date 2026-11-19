/**
 * 賞与の一覧の絞り込み・並べ替え・合計（11/19）
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 */
export type BonusListSort = 'paidDate' | 'title' | 'people' | 'amount';
export type SortDir = 'asc' | 'desc';

/** 賞与の項目で絞る：all＝すべて／loose＝未分類の賞与／それ以外＝項目の名前 */
export interface BonusListFilter {
  from: string; // 'YYYY-MM'（空なら制限なし）
  to: string;
  item: string;
  query: string; // 名称・賞与の項目の名前
}

export interface BonusListOptions {
  sort: BonusListSort;
  dir: SortDir;
  filter: BonusListFilter;
}

export const ITEM_ALL = 'all';
export const ITEM_LOOSE = 'loose';

export function defaultBonusListOptions(): BonusListOptions {
  return { sort: 'paidDate', dir: 'desc', filter: { from: '', to: '', item: ITEM_ALL, query: '' } };
}

/** 使っている条件の数（絞り込みボタンの数） */
export function bonusFilterCount(f: BonusListFilter): number {
  return (f.from || f.to ? 1 : 0) + (f.item !== ITEM_ALL ? 1 : 0);
}

export interface BonusListRowLike {
  payment: { paidDate: string; title: string | null; nature?: string | null; group?: string };
  people: number;
  amountYen: number;
  totalYen: number;
}

/** 行の賞与の項目（項目に当たれば項目の名前、当たらなければ支給の名前。空は「賞与」） */
export function itemNameOf(p: BonusListRowLike['payment'], defaultName: string): string {
  return p.group ?? (p.nature?.trim() || defaultName);
}

export function filterBonusRows<T extends BonusListRowLike>(
  rows: readonly T[],
  f: BonusListFilter,
  defaultName: string,
): T[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    const month = r.payment.paidDate.slice(0, 7);
    if (f.from && month < f.from) return false;
    if (f.to && month > f.to) return false;
    if (f.item === ITEM_LOOSE && r.payment.group) return false;
    if (f.item !== ITEM_ALL && f.item !== ITEM_LOOSE && r.payment.group !== f.item) return false;
    if (q) {
      const text = `${r.payment.title ?? ''} ${itemNameOf(r.payment, defaultName)}`.toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });
}

/** 並べ替え（同じ値なら支払日の新しい順） */
export function sortBonusRows<T extends BonusListRowLike>(
  rows: readonly T[],
  sort: BonusListSort,
  dir: SortDir,
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  const value = (r: T): string | number =>
    sort === 'paidDate'
      ? r.payment.paidDate
      : sort === 'title'
        ? (r.payment.title ?? '')
        : sort === 'people'
          ? r.people
          : r.amountYen;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const c = typeof va === 'number' ? va - (vb as number) : va.localeCompare(vb as string, 'ja');
    // 名称が空の行は、どちらの向きでも最後に
    if (
      sort === 'title' &&
      (!a.payment.title || !b.payment.title) &&
      a.payment.title !== b.payment.title
    ) {
      return a.payment.title ? -1 : 1;
    }
    return c !== 0 ? c * sign : b.payment.paidDate.localeCompare(a.payment.paidDate);
  });
}

/** 合計の行（人数は延べ） */
export function bonusRowsTotal(rows: readonly BonusListRowLike[]): {
  count: number;
  people: number;
  amountYen: number;
  totalYen: number;
} {
  return rows.reduce(
    (s, r) => ({
      count: s.count + 1,
      people: s.people + r.people,
      amountYen: s.amountYen + r.amountYen,
      totalYen: s.totalYen + r.totalYen,
    }),
    { count: 0, people: 0, amountYen: 0, totalYen: 0 },
  );
}
