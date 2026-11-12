import { encodeSjis, normalizeForSjis, toHalfKana, toPlainCsv, unsupportedChars } from './sjis';

describe('Shift_JIS（届書作成プログラム向け）', () => {
  it('英数字・半角カナ・漢字を正しいバイトにする', () => {
    expect([...encodeSjis('A1')]).toEqual([0x41, 0x31]);
    expect([...encodeSjis('ｱ')]).toEqual([0xb1]);
    expect([...encodeSjis('亜')]).toEqual([0x88, 0x9f]);
    expect([...encodeSjis('　')]).toEqual([0x81, 0x40]);
  });
  it('改行は CR LF', () => {
    expect([...encodeSjis('a\nb')]).toEqual([0x61, 0x0d, 0x0a, 0x62]);
  });
  it('JIS 第1・第2水準にない文字（拡張文字・第3水準）を拾う', () => {
    expect(unsupportedChars('髙橋 﨑山 ①')).toEqual(['髙', '﨑', '①']);
    expect(unsupportedChars('高橋 崎山 東京都千代田区')).toEqual([]);
  });
  it('書けない文字があれば例外', () => {
    expect(() => encodeSjis('髙')).toThrow();
  });
});

describe('toHalfKana：半角カナ', () => {
  it('濁点・半濁点は別の1文字。ひらがなもカタカナにしてから', () => {
    expect(toHalfKana('コウネン　タロウ')).toBe('ｺｳﾈﾝ ﾀﾛｳ');
    expect(toHalfKana('がっこう')).toBe('ｶﾞｯｺｳ');
    expect(toHalfKana('パピプペポ・ヴ')).toBe('ﾊﾟﾋﾟﾌﾟﾍﾟﾎﾟ･ｳﾞ');
    expect(toHalfKana('ＡＢＣ１２３')).toBe('ABC123');
  });
});

describe('toPlainCsv', () => {
  it('カンマ・引用符・改行は空白にして、1行ずつつなぐ', () => {
    expect(toPlainCsv([['a,b', 'c"d'], ['e']])).toBe('a b,c d\ne\n');
  });
});

describe('normalizeForSjis', () => {
  it('見た目が同じ文字に言い換えると書ける', () => {
    expect(unsupportedChars('1−2')).toEqual(['−']);
    expect(unsupportedChars(normalizeForSjis('1−2〜3'))).toEqual([]);
  });
});
