import { childNotYounger, dependentBeforeAcquired, remunerationBeforeAcquired } from './cross-checks';

describe('cross-checks（項目どうしの整合。11/28）', () => {
  it('子・孫が被保険者と同じか年上なら知らせる', () => {
    expect(childNotYounger('child', '1980-01-01', '1985-05-05')).toBe(true);
    expect(childNotYounger('grandchild', '1985-05-05', '1985-05-05')).toBe(true);
    expect(childNotYounger('otherChild', '1979-12-31', '1985-05-05')).toBe(true);
    expect(childNotYounger('child', '2015-01-01', '1985-05-05')).toBe(false);
    // 子・孫でなければ比べない
    expect(childNotYounger('parent', '1950-01-01', '1985-05-05')).toBe(false);
    expect(childNotYounger('spouse', '1980-01-01', '1985-05-05')).toBe(false);
    // 生年月日がなければ比べない
    expect(childNotYounger('child', '1980-01-01', null)).toBe(false);
  });

  it('標準報酬の開始月が資格取得月より前なら知らせる', () => {
    expect(remunerationBeforeAcquired('2026-03', '2026-04-01')).toBe(true);
    expect(remunerationBeforeAcquired('2026-04', '2026-04-15')).toBe(false); // 同じ月は正しい
    expect(remunerationBeforeAcquired('2026-09', '2026-04-01')).toBe(false);
    expect(remunerationBeforeAcquired('2026-03', null)).toBe(false);
  });

  it('被扶養者になった日が資格取得日より前なら知らせる（入社日より前は前からの知らせに任せる）', () => {
    expect(dependentBeforeAcquired('2026-05-01', '2026-04-01', '2026-10-01')).toBe(true); // 短時間から加入に変わった人
    expect(dependentBeforeAcquired('2026-10-01', '2026-04-01', '2026-10-01')).toBe(false);
    expect(dependentBeforeAcquired('2026-03-01', '2026-04-01', '2026-04-01')).toBe(false); // 入社前は beforeHire
    expect(dependentBeforeAcquired('2026-05-01', '2026-04-01', null)).toBe(false);
  });
});
