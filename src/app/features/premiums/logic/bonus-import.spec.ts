import { matchBonusRows } from './bonus-import';

const people = [
  { id: 'a', employeeNumber: 'L0001', lastName: '伊藤', firstName: '愛' },
  { id: 'b', employeeNumber: 'L0002', lastName: '佐藤', firstName: '花子' },
  { id: 'c', employeeNumber: null, lastName: '佐藤', firstName: '花子' },
  { id: 'd', employeeNumber: null, lastName: '鈴木', firstName: '一郎' },
];
const head = ['社員番号', '氏名', '賞与額'];

describe('bonus-import', () => {
  it('社員番号で結び、なければ氏名で（同じ氏名が1人のときだけ）', () => {
    const r = matchBonusRows(
      [head, ['L0001', '', '500,000'], ['', '鈴木 一郎', '300000円'], ['', '佐藤花子', '100000'], ['L9999', '', '1']],
      people,
    );
    expect(r.amounts.get('a')).toBe(500000);
    expect(r.amounts.get('d')).toBe(300000);
    expect(r.ambiguous).toEqual(['佐藤花子']);
    expect(r.notFound).toEqual(['L9999']);
  });

  it('金額が読めない行は分けて知らせる', () => {
    const r = matchBonusRows([head, ['L0002', '', 'あ']], people);
    expect(r.badAmount).toEqual(['L0002']);
    expect(r.amounts.size).toBe(0);
  });
});
