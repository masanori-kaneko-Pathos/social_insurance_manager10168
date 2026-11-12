import { defaultListOptions, filterAndSort, matchesQuery, pageOf, PersonLike, searchKey } from './person-list';

const P = (n: string, last: string, kana: string, hire = '2020-04-01'): PersonLike => ({
  employeeNumber: n,
  lastName: last,
  firstName: '',
  lastNameKana: kana,
  firstNameKana: '',
  hireDate: hire,
});

interface Row {
  p: PersonLike;
  c: { employmentType: 'regular' | 'part'; payType: 'monthly' | 'hourly' } | null;
  filled: boolean;
}

const rows: Row[] = [
  { p: P('E10', '山田', 'ヤマダ', '2021-04-01'), c: { employmentType: 'regular', payType: 'monthly' }, filled: true },
  { p: P('E2', '佐藤', 'サトウ', '2019-04-01'), c: { employmentType: 'part', payType: 'hourly' }, filled: false },
  { p: P('E1', '鈴木', 'スズキ', '2022-04-01'), c: null, filled: false },
];
const run = (o: Partial<ReturnType<typeof defaultListOptions>>) =>
  filterAndSort(rows, { ...defaultListOptions(), ...o }, (r) => r.p, (r) => r.c, (r) => r.filled).map((r) => r.p.lastName);

describe('person-list', () => {
  it('ひらがな・全角でも探せる', () => {
    expect(searchKey('やまだ')).toBe('ヤマダ');
    expect(matchesQuery(rows[0].p, 'やま')).toBeTrue();
    expect(matchesQuery(rows[0].p, 'Ｅ１０')).toBeTrue();
    expect(matchesQuery(rows[1].p, 'やま')).toBeFalse();
  });

  it('絞り込み（雇用形態・給与の形・入れたかどうか）', () => {
    expect(run({ employment: 'part' })).toEqual(['佐藤']);
    expect(run({ payType: 'monthly' })).toEqual(['山田']);
    expect(run({ entry: 'empty' })).toEqual(['佐藤', '鈴木']);
  });

  it('並べ方（社員番号は数の順・入社日）', () => {
    expect(run({ sort: 'number' })).toEqual(['鈴木', '佐藤', '山田']);
    expect(run({ sort: 'hire' })).toEqual(['佐藤', '山田', '鈴木']);
    expect(run({})).toEqual(['佐藤', '鈴木', '山田']);
  });

  it('ページに分ける（はみ出したら最後のページ）', () => {
    const list = Array.from({ length: 120 }, (_, i) => i);
    expect(pageOf(list, 1).rows.length).toBe(50);
    expect(pageOf(list, 3)).toEqual(jasmine.objectContaining({ page: 3, pages: 3 }));
    expect(pageOf(list, 3).rows.length).toBe(20);
    expect(pageOf(list, 9).page).toBe(3);
    expect(pageOf([], 1).pages).toBe(1);
  });
});
