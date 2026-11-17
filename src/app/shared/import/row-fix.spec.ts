import { applyCellEdits, cellKey, cellOf, columnsForCodes, errorRowsTable } from './row-fix';
import { applyRowValues, resolveHeader, rowRecord, sameKeyLines } from './row-fix';

const T = [
  ['社員番号', '支払った月', '支払額'],
  ['E1', '2026-10', '300000'],
  ['E2', '2026/13', 'abc'],
];
const labels = (c: string) => ({ month: ['支払った月', 'Paid month'], cash: ['支払額', 'Cash'], days: ['支払基礎日数'] })[c] ?? [c];

describe('row-fix（取り込みのエラーの直し方。11/16）', () => {
  it('直した値を入れる（元の表は変えない・ない列は右に足す・見出しは英語でもよい）', () => {
    const edits = new Map([
      [cellKey(3, 'month'), '2026-11'],
      [cellKey(3, 'cash'), '310000'],
      [cellKey(3, 'days'), '30'],
    ]);
    const out = applyCellEdits(T, edits, labels);
    expect(out[2]).toEqual(['E2', '2026-11', '310000', '30']);
    expect(out[0]).toEqual(['社員番号', '支払った月', '支払額', '支払基礎日数']);
    expect(out[1]).toEqual(['E1', '2026-10', '300000']);
    expect(T[2]).toEqual(['E2', '2026/13', 'abc']);
    const en = applyCellEdits([['Paid month'], ['x']], new Map([[cellKey(2, 'month'), '2026-01']]), labels);
    expect(en).toEqual([['Paid month'], ['2026-01']]);
  });

  it('見出しの行（1行目）や、ない行は書き換えない', () => {
    expect(applyCellEdits(T, new Map([[cellKey(1, 'cash'), 'x'], [cellKey(9, 'cash'), 'y']]), labels)).toEqual(T.map((r) => [...r]));
  });

  it('エラーの行だけを、右端にエラーの列をつけて書き出す（行の順）', () => {
    const out = errorRowsTable(T, new Map([[3, '支払った月：読めません']]), 'エラー');
    expect(out).toEqual([
      ['社員番号', '支払った月', '支払額', 'エラー'],
      ['E2', '2026/13', 'abc', '支払った月：読めません'],
    ]);
  });

  it('コード → 直す欄（重ねない）・今の値', () => {
    const map = { badMonth: ['month'], fixedOverCash: ['cash', 'fixed'], cashRequired: ['cash'] };
    expect(columnsForCodes(['fixedOverCash', 'cashRequired', 'badMonth', 'unknown'], map)).toEqual(['cash', 'fixed', 'month']);
    expect(cellOf(T, 3, ['支払った月'])).toBe('2026/13');
    expect(cellOf(T, 3, ['ない列'])).toBe('');
  });
});

describe('1行ずつ直す窓の道具（11/17）', () => {
  const t = [['社員番号', '氏名', '月'], ['E001', '山田', '2026-01'], ['E002', '佐藤', '2026-01'], ['E001', '山田', '2026-02']];
  it('applyRowValues：1行だけ直す。表にない見出しは右に足す', () => {
    const out = applyRowValues(t, 3, { 氏名: '佐藤花子', メモ: 'x' });
    expect(out[0]).toEqual(['社員番号', '氏名', '月', 'メモ']);
    expect(out[2]).toEqual(['E002', '佐藤花子', '2026-01', 'x']);
    expect(out[1]).toEqual(['E001', '山田', '2026-01']);
    expect(t[2]).toEqual(['E002', '佐藤', '2026-01']);
  });
  it('rowRecord・resolveHeader', () => {
    expect(rowRecord(t, 2)).toEqual({ 社員番号: 'E001', 氏名: '山田', 月: '2026-01' });
    expect(resolveHeader(['Employee number', 'Name'], ['社員番号', 'Employee number'])).toBe('Employee number');
    expect(resolveHeader(['x'], ['社員番号'])).toBe('社員番号');
  });
  it('sameKeyLines：同じ社員番号のほかの行', () => {
    expect(sameKeyLines(t, 2, '社員番号')).toEqual([4]);
    expect(sameKeyLines(t, 3, '社員番号')).toEqual([]);
  });
});
