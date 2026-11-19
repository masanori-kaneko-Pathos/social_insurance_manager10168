import { bonusFilterCount, bonusRowsTotal, defaultBonusListOptions, filterBonusRows, ITEM_LOOSE, sortBonusRows } from './bonus-list-view';

const row = (paidDate: string, title: string | null, people: number, amountYen: number, group?: string, nature?: string) => ({
  payment: { paidDate, title, group, nature: nature ?? null },
  people,
  amountYen,
  totalYen: amountYen / 10,
});
const rows = [
  row('2025-07-10', '夏季賞与', 10, 3000000, '賞与'),
  row('2025-12-10', '冬季賞与', 12, 4000000, '賞与'),
  row('2026-03-31', null, 3, 300000, undefined, '決算賞与'),
];

describe('賞与の一覧の絞り込み・並べ替え（11/19）', () => {
  it('期間（月）で絞る', () => {
    const f = { ...defaultBonusListOptions().filter, from: '2025-08', to: '2026-03' };
    expect(filterBonusRows(rows, f, '賞与').map((r) => r.payment.paidDate)).toEqual(['2025-12-10', '2026-03-31']);
    expect(bonusFilterCount(f)).toBe(1);
  });
  it('賞与の項目・まだ決めていない名前・文字で絞る', () => {
    const base = defaultBonusListOptions().filter;
    expect(filterBonusRows(rows, { ...base, item: '賞与' }, '賞与').length).toBe(2);
    expect(filterBonusRows(rows, { ...base, item: ITEM_LOOSE }, '賞与').map((r) => r.payment.paidDate)).toEqual(['2026-03-31']);
    expect(filterBonusRows(rows, { ...base, query: '決算' }, '賞与').length).toBe(1);
    expect(filterBonusRows(rows, { ...base, query: '冬季' }, '賞与').length).toBe(1);
  });
  it('並べ替え：人数・賞与額・名称（空の名称は最後）', () => {
    expect(sortBonusRows(rows, 'people', 'asc').map((r) => r.people)).toEqual([3, 10, 12]);
    expect(sortBonusRows(rows, 'amount', 'desc').map((r) => r.amountYen)).toEqual([4000000, 3000000, 300000]);
    expect(sortBonusRows(rows, 'title', 'asc').map((r) => r.payment.title)).toEqual(['夏季賞与', '冬季賞与', null]);
    expect(sortBonusRows(rows, 'title', 'desc').map((r) => r.payment.title)).toEqual(['冬季賞与', '夏季賞与', null]);
  });
  it('合計（人数は延べ）', () => {
    expect(bonusRowsTotal(rows)).toEqual({ count: 3, people: 25, amountYen: 7300000, totalYen: 730000 });
  });
});
