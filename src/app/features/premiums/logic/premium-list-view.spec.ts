import { nextSort, sortPremiumRows, standardView, DEFAULT_PREMIUM_SORT } from './premium-list-view';

const emp = (id: string, no: string | null, kana: string) =>
  ({
    id,
    employeeNumber: no,
    lastName: kana,
    firstName: '',
    lastNameKana: kana,
    firstNameKana: '',
    birthDate: '1990-01-01',
    hireDate: '2020-04-01',
    nameOrder: 'family',
    foreign: null,
  }) as never;

const row = (id: string, no: string | null, kana: string, state: string, employeeYen: number, employerMilli: number) => ({
  employee: emp(id, no, kana),
  state: state as never,
  result: { employeeYen },
  premiumEmployerMilli: employerMilli,
});

const rows = [
  row('a', 'T10', 'サトウ', 'ok', 30000, 30000_000),
  row('b', 'T2', 'アベ', 'ok', 15000, 15000_400),
  row('c', null, 'イトウ', 'missing', 0, 0),
  row('d', 'T5', 'ウエダ', 'exempt', 0, 0),
  row('e', 'T3', 'カトウ', 'ok', 30000, 29999_600),
];
const ids = (xs: { employee: { id: string } }[]) => xs.map((x) => (x.employee as { id: string }).id).join('');

describe('保険料一覧の並べ替え', () => {
  it('最初は社員番号の順（数字として。番号のない人は最後）。未登録は上に固定', () => {
    expect(ids(sortPremiumRows(rows, DEFAULT_PREMIUM_SORT))).toBe('cbeda');
  });
  it('氏名はフリガナの順、逆向きもできる', () => {
    expect(ids(sortPremiumRows(rows, { key: 'name', dir: 'asc' }))).toBe('cbdea');
    expect(ids(sortPremiumRows(rows, { key: 'name', dir: 'desc' }))).toBe('caedb');
  });
  it('本人負担は金額の順。同じ額なら社員番号の順、免除（0円）は端', () => {
    expect(ids(sortPremiumRows(rows, { key: 'employee', dir: 'desc' }))).toBe('ceabd');
    expect(ids(sortPremiumRows(rows, { key: 'employee', dir: 'asc' }))).toBe('cdbea');
  });
  it('会社負担は1円未満まで比べる', () => {
    expect(ids(sortPremiumRows(rows, { key: 'employer', dir: 'desc' }))).toBe('caebd');
  });
  it('見出しを押したときの次の並び', () => {
    expect(nextSort({ key: 'number', dir: 'asc' }, 'number')).toEqual({ key: 'number', dir: 'desc' });
    expect(nextSort({ key: 'number', dir: 'asc' }, 'employee')).toEqual({ key: 'employee', dir: 'desc' });
    expect(nextSort({ key: 'employee', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
  });
});

describe('標準報酬月額の出し方', () => {
  it('同じなら1つ、違えば2段、片方だけならその1つ', () => {
    expect(standardView({ standard: 300000 }, { standard: 300000 })).toEqual({ kind: 'one', yen: 300000 });
    expect(standardView({ standard: 1390000 }, { standard: 650000 })).toEqual({ kind: 'split', health: 1390000, pension: 650000 });
    expect(standardView({ standard: 200000 }, null)).toEqual({ kind: 'one', yen: 200000 });
    expect(standardView(null, null)).toBeNull();
  });
});
