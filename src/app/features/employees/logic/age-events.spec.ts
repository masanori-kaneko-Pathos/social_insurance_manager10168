import {
  ageEventOf,
  ageEventsIn,
  AgeTarget,
  compareAgeEvents,
  isActive,
  sortMonthOf,
} from './age-events';

function target(birthDate: string, opts: Partial<AgeTarget> = {}): AgeTarget {
  return {
    birthDate,
    retireDate: null,
    health: { enrolled: true, acquiredDate: '2020-04-01', lostDate: null },
    pension: { enrolled: true, acquiredDate: '2020-04-01', lostDate: null },
    ...opts,
  };
}

describe('ageEventOf', () => {
  it('40歳：1日生まれは影響が誕生日の前の月に出る', () => {
    const ev = ageEventOf('1986-12-01', 40);
    expect(ev.birthday).toBe('2026-12-01');
    expect(ev.reachDate).toBe('2026-11-30');
    expect(ev.effectMonth).toBe('2026-11');
  });

  it('75歳：影響は誕生日の月（1日生まれでも前の月にならない）', () => {
    const ev = ageEventOf('1951-12-01', 75);
    expect(ev.effectMonth).toBe('2026-12');
  });
});

describe('ageEventsIn', () => {
  it('誕生日か影響が出る月のどちらかが範囲に入れば拾う', () => {
    // 12/1 生まれ：誕生日は12月、40歳の影響は11月 → 「今月（11月）」でも拾う
    const e = target('1986-12-01');
    expect(ageEventsIn(e, '2026-11', '2026-11').map((x) => x.age)).toEqual([40]);
  });

  it('範囲の外は拾わない', () => {
    const e = target('1986-06-15');
    expect(ageEventsIn(e, '2026-11', '2027-04')).toEqual([]);
  });

  it('70歳は厚年に入っていない人には出さない（60歳は出す）', () => {
    const e = target('1956-11-15', {
      pension: { enrolled: false, acquiredDate: null, lostDate: null },
    });
    expect(ageEventsIn(e, '2026-11', '2026-11').map((x) => x.age)).toEqual([]);
    const e60 = target('1966-11-15', {
      health: { enrolled: false, acquiredDate: null, lostDate: null },
    });
    expect(ageEventsIn(e60, '2026-11', '2026-11').map((x) => x.age)).toEqual([60]);
  });

  it('年齢を絞り込める', () => {
    const e = target('1986-12-10');
    expect(ageEventsIn(e, '2026-11', '2026-12', [70, 75])).toEqual([]);
  });
});

describe('並べ方・在籍', () => {
  it('1日生まれは、誕生日順なら誕生日の月、影響順なら前の月に並ぶ', () => {
    const a = ageEventOf('1986-12-01', 40); // 誕生日12月・影響11月
    expect(sortMonthOf(a, 'birthday')).toBe('2026-12');
    expect(sortMonthOf(a, 'effect')).toBe('2026-11');
  });

  it('同じ月の中は誕生日の順', () => {
    const a = ageEventOf('1956-11-20', 70);
    const b = ageEventOf('1986-11-05', 40);
    expect(compareAgeEvents(a, b, 'birthday')).toBeGreaterThan(0);
  });

  it('退職日が今日より前なら在籍していない', () => {
    expect(isActive(target('1990-01-01', { retireDate: '2026-10-31' }), '2026-11-05')).toBeFalse();
    expect(isActive(target('1990-01-01', { retireDate: '2026-11-30' }), '2026-11-05')).toBeTrue();
  });
});
