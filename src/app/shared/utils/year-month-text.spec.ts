import { yearMonthParams, yearMonthText } from './year-month-text';

describe('year-month-text（生の年月を言葉に。11/27）', () => {
  it('年月だけを形に当てはめる', () => {
    expect(yearMonthText('2024-11', '{{y}}年{{m}}月')).toBe('2024年11月');
    expect(yearMonthText('2026-03', '{{y}}年{{m}}月')).toBe('2026年3月');
    expect(yearMonthText('2026-03', '{{mon}} {{y}}')).toBe('Mar 2026');
  });
  it('日付・社員番号・電話番号などはそのまま', () => {
    for (const v of ['2026-11-27', '0120-12', '1234-56', '2026-13', 'B11', '']) {
      expect(yearMonthText(v, '{{y}}年{{m}}月')).toBe(v);
    }
  });
  it('引数のうち年月の値だけを変える（ほかはそのまま。変えるものがなければ同じもの）', () => {
    const p = { from: '2024-11', n: 3, date: '2026-11-27', name: 'テスト' };
    expect(yearMonthParams(p, '{{y}}年{{m}}月')).toEqual({ from: '2024年11月', n: 3, date: '2026-11-27', name: 'テスト' });
    const same = { n: 1 };
    expect(yearMonthParams(same, '{{y}}年{{m}}月')).toBe(same);
  });
});
