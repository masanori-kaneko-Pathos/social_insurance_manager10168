import { CoverageInput, ageReachDate, coverageForMonth, defaultEnrollmentDates, emptyReason, isChargedMonth } from './coverage';
import { monthsOfFiscalYear, fiscalYearOf } from '../../../shared/utils/date';

/** テスト用の従業員を作る（健保・厚年とも加入、指定がなければ退職なし） */
function employee(birthDate: string, acquired: string, lost: string | null = null): CoverageInput {
  return {
    birthDate,
    health: { enrolled: true, acquiredDate: acquired, lostDate: lost },
    pension: { enrolled: true, acquiredDate: acquired, lostDate: lost },
  };
}

describe('年齢到達日（誕生日の前日）', () => {
  it('4月15日生まれは、4月14日に到達する', () => {
    expect(ageReachDate('1985-04-15', 40)).toBe('2025-04-14');
  });

  it('4月1日生まれは、前の月の3月31日に到達する', () => {
    expect(ageReachDate('1985-04-01', 40)).toBe('2025-03-31');
  });

  it('2月29日生まれは、平年では2月28日に到達する', () => {
    expect(ageReachDate('1988-02-29', 37)).toBe('2025-02-28');
  });
});

describe('保険料がかかる月（取得月から喪失月の前月まで）', () => {
  it('取得した月はかかる', () => {
    expect(isChargedMonth('2025-04-01', null, '2025-04')).toBeTrue();
  });

  it('取得する前の月はかからない', () => {
    expect(isChargedMonth('2025-04-01', null, '2025-03')).toBeFalse();
  });

  it('月末退職（喪失日は翌月1日）：退職した月まではかかり、翌月はかからない', () => {
    expect(isChargedMonth('2025-04-01', '2025-10-01', '2025-09')).toBeTrue();
    expect(isChargedMonth('2025-04-01', '2025-10-01', '2025-10')).toBeFalse();
  });

  it('月の途中で退職：退職した月はかからない（喪失月の前月まで）', () => {
    expect(isChargedMonth('2025-04-01', '2025-09-16', '2025-08')).toBeTrue();
    expect(isChargedMonth('2025-04-01', '2025-09-16', '2025-09')).toBeFalse();
  });

  it('同じ月に取得して喪失：その月はかかる', () => {
    expect(isChargedMonth('2025-04-01', '2025-04-21', '2025-04')).toBeTrue();
    expect(isChargedMonth('2025-04-01', '2025-04-21', '2025-05')).toBeFalse();
  });
});

describe('介護保険（40歳以上65歳未満）', () => {
  it('4月15日生まれ：40歳になる4月からかかる', () => {
    const e = employee('1985-04-15', '2020-04-01');
    expect(coverageForMonth(e, '2025-03').care).toBeFalse();
    expect(coverageForMonth(e, '2025-04').care).toBeTrue();
  });

  it('4月1日生まれ：到達日が3月31日なので、3月からかかる', () => {
    const e = employee('1985-04-01', '2020-04-01');
    expect(coverageForMonth(e, '2025-02').care).toBeFalse();
    expect(coverageForMonth(e, '2025-03').care).toBeTrue();
  });

  it('65歳になる月からはかからない', () => {
    const e = employee('1960-06-15', '2000-04-01');
    expect(coverageForMonth(e, '2025-05').care).toBeTrue();
    expect(coverageForMonth(e, '2025-06').care).toBeFalse();
  });

  it('健康保険に加入していなければ、40代でもかからない', () => {
    const e = employee('1985-04-15', '2020-04-01');
    e.health.enrolled = false;
    expect(coverageForMonth(e, '2025-06').care).toBeFalse();
  });
});

describe('年齢による喪失', () => {
  it('厚生年金：70歳到達の月からかからない（健康保険は続く）', () => {
    const e = employee('1955-08-20', '2000-04-01');
    expect(coverageForMonth(e, '2025-07').pension).toBeTrue();
    expect(coverageForMonth(e, '2025-08').pension).toBeFalse();
    expect(coverageForMonth(e, '2025-08').health).toBeTrue();
  });

  it('健康保険：75歳の誕生日の月からかからない', () => {
    const e = employee('1950-08-20', '2000-04-01');
    expect(coverageForMonth(e, '2025-07').health).toBeTrue();
    expect(coverageForMonth(e, '2025-08').health).toBeFalse();
  });
});

describe('年齢到達の月に入社した人', () => {
  it('75歳の誕生日より後に入社：健保の資格を取らない', () => {
    const e = employee('1951-10-05', '2026-10-10'); // 75歳の誕生日 2026-10-05
    expect(coverageForMonth(e, '2026-10').health).toBeFalse();
  });

  it('75歳の誕生日より前に、同じ月に入社：同月得喪でその月はかかる', () => {
    const e = employee('1951-10-20', '2026-10-01');
    expect(coverageForMonth(e, '2026-10').health).toBeTrue();
    expect(coverageForMonth(e, '2026-11').health).toBeFalse();
  });

  it('70歳到達日より後に入社：厚年の資格は取らないが、健保はかかる', () => {
    const e = employee('1956-10-20', '2026-10-25'); // 70歳到達日 2026-10-19
    expect(coverageForMonth(e, '2026-10').pension).toBeFalse();
    expect(coverageForMonth(e, '2026-10').health).toBeTrue();
  });

  it('isChargedMonth：喪失日が取得日以前なら、どの月もかからない', () => {
    expect(isChargedMonth('2026-10-10', '2026-10-05', '2026-10')).toBeFalse();
    expect(isChargedMonth('2026-10-05', '2026-10-05', '2026-10')).toBeFalse();
  });
});

describe('加入しない人', () => {
  it('健保・厚年とも加入しない場合は、すべてかからない', () => {
    const e = employee('1990-01-10', '2025-04-01');
    e.health.enrolled = false;
    e.pension.enrolled = false;
    const c = coverageForMonth(e, '2025-06');
    expect(c.health || c.care || c.pension).toBeFalse();
  });
});

describe('期間の一覧と初期値', () => {
  it('年度は4月から翌年3月までの12か月', () => {
    const months = monthsOfFiscalYear(2025);
    expect(months.length).toBe(12);
    expect(months[0]).toBe('2025-04');
    expect(months[11]).toBe('2026-03');
  });

  it('喪失日の初期値は退職日の翌日（月末退職なら翌月1日）', () => {
    expect(defaultEnrollmentDates('2025-04-01', '2025-09-30').lostDate).toBe('2025-10-01');
    expect(defaultEnrollmentDates('2025-04-01', null).lostDate).toBeNull();
  });
});

it('fiscalYearOf：1〜3月は前の年度、4月からその年の年度', () => {
  expect(fiscalYearOf('2027-03')).toBe(2026);
  expect(fiscalYearOf('2026-04')).toBe(2026);
});

describe('emptyReason：表の月がすべて空のときの理由', () => {
  const fy2026 = monthsOfFiscalYear(2026); // 2026-04 〜 2027-03

  it('1か月でもかかる月があれば null', () => {
    expect(emptyReason(employee('1990-05-15', '2026-11-01'), fy2026)).toBeNull();
  });
  it('どちらの保険にも加入していない', () => {
    const e = employee('1990-05-15', '2024-04-01');
    e.health.enrolled = false;
    e.pension.enrolled = false;
    expect(emptyReason(e, fy2026)).toEqual({ kind: 'notEnrolled' });
  });
  it('表の月より後に取得する（来年度に入社）', () => {
    expect(emptyReason(employee('1990-05-15', '2027-04-01'), fy2026)).toEqual({
      kind: 'beforeAcquire',
      date: '2027-04-01',
    });
  });
  it('表の月より前に喪失している（退職済み）', () => {
    expect(emptyReason(employee('1990-05-15', '2020-04-01', '2026-03-21'), fy2026)).toEqual({
      kind: 'afterLoss',
      date: '2026-03-21',
      age: null,
    });
  });
  it('75歳の誕生日で喪失（厚年は70歳でもう喪失）', () => {
    // 1951-03-10 生まれ：75歳の誕生日は 2026-03-10
    expect(emptyReason(employee('1951-03-10', '2018-04-01'), fy2026)).toEqual({
      kind: 'afterLoss',
      date: '2026-03-10',
      age: 75,
    });
  });
  it('健保だけ加入していて、75歳で喪失', () => {
    const e = employee('1951-03-10', '2018-04-01');
    e.pension.enrolled = false;
    expect(emptyReason(e, fy2026)?.kind).toBe('afterLoss');
  });
  it('表の途中に短い在籍（同月得喪）があれば null', () => {
    expect(emptyReason(employee('1990-05-15', '2026-06-10', '2026-06-26'), fy2026)).toBeNull();
  });
  it('月がなければ null', () => {
    expect(emptyReason(employee('1990-05-15', '2027-04-01'), [])).toBeNull();
  });
});
