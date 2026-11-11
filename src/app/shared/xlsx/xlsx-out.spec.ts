import { columnWidths, toCell } from './xlsx-out';

describe('xlsx-out：書き出しのセル', () => {
  it('数字は数値に。先頭が0の番号は文字のまま', () => {
    expect(toCell('41000')).toEqual({ t: 'n', v: 41000, z: '#,##0' });
    expect(toCell('16745.5')).toEqual({ t: 'n', v: 16745.5, z: '#,##0.###' });
    expect(toCell('12')).toEqual({ t: 'n', v: 12 });
    expect(toCell('0012')).toEqual({ t: 's', v: '0012' });
    expect(toCell('0')).toEqual({ t: 'n', v: 0 });
    expect(toCell('伊藤 一郎')).toEqual({ t: 's', v: '伊藤 一郎' });
    expect(toCell('')).toEqual({ t: 's', v: '' });
  });
  it('列の幅：全角は2つ分', () => {
    expect(columnWidths([['abc', '氏名'], ['a']])).toEqual([8, 8]);
    expect(columnWidths([['あいうえおかきくけこ']])).toEqual([22]);
  });
});
