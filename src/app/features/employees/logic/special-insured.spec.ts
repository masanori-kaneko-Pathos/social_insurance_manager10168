import { careDependentIn, specialEnabledAt, specialInsuredFor, specialInsuredIn, usesSpecialInsured } from './special-insured';

describe('特定被保険者（11/26）', () => {
  // 本人 30歳（1996-05-10 生まれ）、配偶者 1985-03-15 生まれ（2025-03 に40歳到達、2050-03 に65歳到達）
  const spouse = { birthDate: '1985-03-15', from: '2020-04-01', to: null };

  it('被扶養者が40〜64歳の月だけ数える（40歳到達の月から、65歳到達の月の前月まで）', () => {
    expect(careDependentIn(spouse, '2025-02')).toBeFalse();
    expect(careDependentIn(spouse, '2025-03')).toBeTrue();
    expect(careDependentIn(spouse, '2050-02')).toBeTrue();
    expect(careDependentIn(spouse, '2050-03')).toBeFalse();
  });

  it('1日生まれは、誕生日の前日（前の月の末日）が到達日なので前の月から', () => {
    expect(careDependentIn({ birthDate: '1986-07-01', from: '2020-04-01', to: null }, '2026-06')).toBeTrue();
  });

  it('扶養に入った日の月から、外れた日の月の前月まで', () => {
    const d = { birthDate: '1980-01-10', from: '2026-04-15', to: '2026-09-20' };
    expect(careDependentIn(d, '2026-03')).toBeFalse();
    expect(careDependentIn(d, '2026-04')).toBeTrue();
    expect(careDependentIn(d, '2026-08')).toBeTrue();
    expect(careDependentIn(d, '2026-09')).toBeFalse();
  });

  it('海外特例で国外に住んでいる期間は数えない', () => {
    const d = { ...spouse, overseas: { from: '2026-06-10', to: '2026-10-05' } };
    expect(careDependentIn(d, '2026-05')).toBeTrue();
    expect(careDependentIn(d, '2026-06')).toBeFalse();
    expect(careDependentIn(d, '2026-09')).toBeFalse();
    expect(careDependentIn(d, '2026-10')).toBeTrue();
  });

  it('本人が40歳未満で、40〜64歳の被扶養者がいれば特定被保険者', () => {
    expect(specialInsuredIn('1996-05-10', [spouse], '2026-11', true)).toBeTrue();
    expect(specialInsuredIn('1996-05-10', [spouse], '2024-11', true)).toBeFalse(); // 配偶者がまだ40歳前
  });

  it('本人が40〜64歳の月は、ふつうの介護保険料なので特定被保険者ではない', () => {
    expect(specialInsuredIn('1980-01-10', [spouse], '2026-11', true)).toBeFalse();
  });

  it('本人が65歳以上でも、40〜64歳の被扶養者がいれば特定被保険者', () => {
    expect(specialInsuredIn('1958-02-01', [spouse], '2026-11', true)).toBeTrue();
  });

  it('制度を採用していない保険者（協会けんぽ・採用していない組合）の月は対象外', () => {
    expect(specialInsuredIn('1996-05-10', [spouse], '2026-11', false)).toBeFalse();
  });

  it('保険者の履歴から、その月に採用している組合かを見る', () => {
    const history = [
      { from: '0000-01', healthInsurer: { type: 'kyokai' } },
      { from: '2026-04', healthInsurer: { type: 'kumiai', specialInsured: true } },
      { from: '2027-04', healthInsurer: { type: 'kumiai', specialInsured: false } },
    ];
    expect(specialEnabledAt(history, '2026-03')).toBeFalse();
    expect(specialEnabledAt(history, '2026-04')).toBeTrue();
    expect(specialEnabledAt(history, '2027-04')).toBeFalse();
    expect(usesSpecialInsured(history)).toBeTrue();
    const f = specialInsuredFor(history, '1996-05-10', [spouse]);
    expect(['2026-03', '2026-04', '2027-04'].map(f)).toEqual([false, true, false]);
  });
});
