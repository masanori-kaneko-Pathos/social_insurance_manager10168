import { decodeCsv, isBlankRow, parseCsv, safeFileName, toCsv } from './csv';

describe('parseCsv', () => {
  it('ふつうの行と CRLF・LF', () => {
    expect(parseCsv('a,b\r\nc,d\ne,f')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
  });
  it('最後の改行は空行にしない', () => {
    expect(parseCsv('a,b\r\n')).toEqual([['a', 'b']]);
  });
  it('"" で囲んだ値（カンマ・改行・"" の二重）', () => {
    expect(parseCsv('"320,000","1行目\n2行目","a""b"')).toEqual([['320,000', '1行目\n2行目', 'a"b']]);
  });
  it('空の列', () => {
    expect(parseCsv('a,,c\n,,')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });
  it('BOM を取る', () => {
    expect(parseCsv('﻿社員番号,氏名')).toEqual([['社員番号', '氏名']]);
  });
});

describe('toCsv と parseCsv は行き来できる', () => {
  it('特殊な文字を含んでも戻る', () => {
    const rows = [
      ['社員番号', '氏名', 'メモ'],
      ['0012', 'テスト 一郎', '"引用",カンマ\n改行'],
      ['', ' 前後に空白 ', ''],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('decodeCsv', () => {
  it('UTF-8（BOM つき）', () => {
    const bytes = new TextEncoder().encode('﻿社員番号,氏名');
    expect(decodeCsv(bytes)).toEqual({ text: '社員番号,氏名', encoding: 'utf-8' });
  });
  it('Shift_JIS（「社員番号」）', () => {
    // 社=8ED0 員=88F5 番=94D4 号=8D86
    const bytes = new Uint8Array([0x8e, 0xd0, 0x88, 0xf5, 0x94, 0xd4, 0x8d, 0x86]);
    expect(decodeCsv(bytes)).toEqual({ text: '社員番号', encoding: 'shift_jis' });
  });
});

describe('小さな道具', () => {
  it('isBlankRow', () => {
    expect(isBlankRow(['', ' ', ''])).toBeTrue();
    expect(isBlankRow(['', '1'])).toBeFalse();
  });
  it('safeFileName', () => {
    expect(safeFileName('a/b:c')).toBe('a_b_c');
  });
});
