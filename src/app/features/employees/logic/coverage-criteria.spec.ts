import {
  countHeadcount,
  criteriaAt,
  HeadcountTarget,
  isSpecificApplied,
  threeQuartersOf,
  WorkSchedule,
} from './coverage';

const STD: WorkSchedule = { weeklyMinutes: 2400, monthlyDays: 20 }; // 週40時間・月20日

describe('threeQuartersOf：4分の3基準', () => {
  it('週30時間・月15日ちょうどは満たす（40の4分の3＝30、20の4分の3＝15）', () => {
    expect(threeQuartersOf({ weeklyMinutes: 1800, monthlyDays: 15 }, STD)).toBe('meets');
  });
  it('時間が1分でも足りなければ短時間労働者の判定へ', () => {
    expect(threeQuartersOf({ weeklyMinutes: 1799, monthlyDays: 20 }, STD)).toBe('below');
  });
  it('時間は足りても日数が足りなければ below（どちらも必要）', () => {
    expect(threeQuartersOf({ weeklyMinutes: 2400, monthlyDays: 14 }, STD)).toBe('below');
  });
  it('事業所の所定がなければ判定できない', () => {
    expect(threeQuartersOf({ weeklyMinutes: 2400, monthlyDays: 20 }, null)).toBe('unknown');
  });
});

describe('isSpecificApplied：特定適用事業所か', () => {
  it('該当した月から true、前の月は false', () => {
    const s = { since: '2027-10' };
    expect(isSpecificApplied(s, '2027-09')).toBeFalse();
    expect(isSpecificApplied(s, '2027-10')).toBeTrue();
    expect(isSpecificApplied(s, '2030-01')).toBeTrue();
  });
  it('該当していない・項目がない古いデータは false', () => {
    expect(isSpecificApplied({ since: null }, '2027-10')).toBeFalse();
    expect(isSpecificApplied(undefined, '2027-10')).toBeFalse();
  });
});

describe('criteriaAt：その月の基準', () => {
  const rows = [
    { from: '2024-10', sizeMin: 51 },
    { from: '2027-10', sizeMin: 36 },
    { from: '2035-10', sizeMin: null },
  ];
  it('切り替わる月から新しい基準', () => {
    expect(criteriaAt(rows, '2027-09')?.sizeMin).toBe(51);
    expect(criteriaAt(rows, '2027-10')?.sizeMin).toBe(36);
    expect(criteriaAt(rows, '2035-10')?.sizeMin).toBeNull();
  });
  it('いちばん古い行より前は null', () => {
    expect(criteriaAt(rows, '2024-09')).toBeNull();
  });
});

describe('countHeadcount：企業規模の人数', () => {
  const full = (from = '2020-04-01') => ({ from, weeklyMinutes: 2400, monthlyDays: 20 });
  const part = (from = '2020-04-01') => ({ from, weeklyMinutes: 1200, monthlyDays: 12 });
  const person = (p: Partial<HeadcountTarget>): HeadcountTarget => ({
    birthDate: '1990-05-15',
    hireDate: '2020-04-01',
    retireDate: null,
    contracts: [full()],
    ...p,
  });

  it('フルタイムは数え、短時間労働者は数えない', () => {
    const r = countHeadcount([person({}), person({ contracts: [part()] })], STD, '2026-11');
    expect(r).toEqual({ counted: 1, noContract: 0 });
  });
  it('入社の月から、退職の月まで数える', () => {
    const p = person({ hireDate: '2026-11-20', retireDate: '2027-01-10', contracts: [full('2026-11-20')] });
    expect(countHeadcount([p], STD, '2026-10')?.counted).toBe(0);
    expect(countHeadcount([p], STD, '2026-11')?.counted).toBe(1);
    expect(countHeadcount([p], STD, '2027-01')?.counted).toBe(1);
    expect(countHeadcount([p], STD, '2027-02')?.counted).toBe(0);
  });
  it('70歳到達の月からは数えない（厚年の資格がない）', () => {
    // 1956-08-01 生まれ：70歳到達日は 2026-07-31 → 7月から数えない
    const p = person({ birthDate: '1956-08-01' });
    expect(countHeadcount([p], STD, '2026-06')?.counted).toBe(1);
    expect(countHeadcount([p], STD, '2026-07')?.counted).toBe(0);
  });
  it('月の途中で契約が変わったら、末日の契約で判定', () => {
    const p = person({ contracts: [part('2020-04-01'), full('2026-11-16')] });
    expect(countHeadcount([p], STD, '2026-10')?.counted).toBe(0);
    expect(countHeadcount([p], STD, '2026-11')?.counted).toBe(1);
  });
  it('契約がない人は noContract に分けて数える', () => {
    expect(countHeadcount([person({ contracts: [] })], STD, '2026-11')).toEqual({ counted: 0, noContract: 1 });
  });
  it('事業所の所定がなければ数えられない', () => {
    expect(countHeadcount([person({})], null, '2026-11')).toBeNull();
  });
});
