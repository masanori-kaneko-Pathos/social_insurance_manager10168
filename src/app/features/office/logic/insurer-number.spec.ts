import { insurerCheckDigit, insurerNumberError, normalizeInsurerNumber } from './insurer-number';

describe('保険者番号（組合）', () => {
  it('資料の例：06 13 048 の検証番号は 8', () => {
    expect(insurerCheckDigit('0613048')).toBe(8);
    expect(insurerNumberError('06130488')).toBeNull();
  });

  it('合計の下1桁が 0 なら検証番号は 0', () => {
    // 0,6,1,3,0,0,9 → 末尾から ×2・×1…：9×2=18→1+8=9, 0, 0, 3, 1×2=2, 6, 0 → 20 → 下1桁 0
    expect(insurerCheckDigit('0613009')).toBe(0);
    expect(insurerNumberError('06130090')).toBeNull();
  });

  it('全角・空白・ハイフンはそろえて読む', () => {
    expect(normalizeInsurerNumber('０６ １３-０４８８')).toBe('06130488');
    expect(insurerNumberError('０６１３０４８８')).toBeNull();
  });

  it('間違いの理由', () => {
    expect(insurerNumberError('')).toBeNull();
    expect(insurerNumberError('0613048')).toBe('format');
    expect(insurerNumberError('0613048a')).toBe('format');
    expect(insurerNumberError('01130012')).toBe('notKumiai'); // 協会けんぽの番号の形
    expect(insurerNumberError('06480480')).toBe('prefecture');
    expect(insurerNumberError('06130487')).toBe('checkDigit');
  });
});
