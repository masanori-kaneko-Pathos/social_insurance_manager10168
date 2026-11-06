import {
  formatPensionNumber,
  formatPostalCode,
  toHalfDigits,
  toHalfWidth,
  toKatakana,
} from './text';

describe('text', () => {
  it('toHalfWidth は英数字・記号・全角スペースを半角に', () => {
    expect(toHalfWidth('ＡＢ１２－３　４')).toBe('AB12-3 4');
  });

  it('toHalfDigits は数字だけ半角に（漢字・カナ・全角英字はそのまま）', () => {
    expect(toHalfDigits('第１２３号　ＡＢ')).toBe('第123号　ＡＢ');
    expect(toHalfDigits('０９')).toBe('09');
  });

  it('toKatakana はひらがなをカタカナに', () => {
    expect(toKatakana('ぐえん ばん')).toBe('グエン バン');
    expect(toKatakana('ラマー')).toBe('ラマー');
  });

  it('郵便番号は 3-4 で区切って表示', () => {
    expect(formatPostalCode('1000001')).toBe('100-0001');
    expect(formatPostalCode(null)).toBe('');
    expect(formatPostalCode('100-0001')).toBe('100-0001'); // 古い形はそのまま
  });

  it('基礎年金番号は 4-6 で区切って表示', () => {
    expect(formatPensionNumber('1234567890')).toBe('1234-567890');
    expect(formatPensionNumber('')).toBe('');
  });
});
