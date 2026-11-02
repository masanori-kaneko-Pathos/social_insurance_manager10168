import { Enrollment } from '../../../core/models/employee';
import {
  CoverageInput,
  ageReachDate,
  coverageForMonth,
  fiscalYearMonths,
  lostDateFromRetire,
} from './coverage';

/** テスト用：健保・厚年とも同じ日に取得した人を作る */
function person(birthDate: string, acquired: string, lost: string | null = null): CoverageInput {
  const e: Enrollment = { enrolled: true, acquiredDate: acquired, lostDate: lost };
  return { birthDate, health: { ...e }, pension: { ...e } };
}

describe('年齢到達日', () => {
  it('誕生日の前日に年齢が増える', () => {
    expect(ageReachDate('1986-04-15', 40)).toBe('2026-04-14');
  });

  it('1日生まれは前月末に到達する', () => {
    expect(ageReachDate('1986-04-01', 40)).toBe('2026-03-31');
  });

  it('2/29生まれは平年だと 2/28 に到達する', () => {
    expect(ageReachDate('2000-02-29', 1)).toBe('2001-02-28');
  });
});

describe('資格喪失日', () => {
  it('退職日の翌日（月をまたぐ）', () => {
    expect(lostDateFromRetire('2026-06-30')).toBe('2026-07-01');
  });
});

describe('保険料がかかる月', () => {
  it('取得した月からかかる', () => {
    const p = person('1990-01-10', '2026-04-20');
    expect(coverageForMonth(p, '2026-03').health).toBe(false);
    expect(coverageForMonth(p, '2026-04').health).toBe(true);
  });

  it('月末に退職すると、その月までかかる', () => {
    const p = person('1990-01-10', '2026-04-01', lostDateFromRetire('2026-06-30'));
    expect(coverageForMonth(p, '2026-06').health).toBe(true);
    expect(coverageForMonth(p, '2026-07').health).toBe(false);
  });

  it('月末の前日に退職すると、その月はかからない', () => {
    const p = person('1990-01-10', '2026-04-01', lostDateFromRetire('2026-06-29'));
    expect(coverageForMonth(p, '2026-05').health).toBe(true);
    expect(coverageForMonth(p, '2026-06').health).toBe(false);
  });

  it('同じ月に取得・喪失すると、その月だけかかる', () => {
    const p = person('1990-01-10', '2026-04-10', '2026-04-20');
    expect(coverageForMonth(p, '2026-04').health).toBe(true);
    expect(coverageForMonth(p, '2026-05').health).toBe(false);
  });

  it('加入しない場合はかからない', () => {
    const p = person('1990-01-10', '2026-04-01');
    p.pension.enrolled = false;
    expect(coverageForMonth(p, '2026-04').pension).toBe(false);
    expect(coverageForMonth(p, '2026-04').health).toBe(true);
  });
});

describe('介護保険', () => {
  it('40歳到達月からかかる', () => {
    const p = person('1986-04-15', '2020-04-01');
    expect(coverageForMonth(p, '2026-03').care).toBe(false);
    expect(coverageForMonth(p, '2026-04').care).toBe(true);
  });

  it('1日生まれは誕生月の前月からかかる', () => {
    const p = person('1986-04-01', '2020-04-01');
    expect(coverageForMonth(p, '2026-02').care).toBe(false);
    expect(coverageForMonth(p, '2026-03').care).toBe(true);
  });

  it('65歳到達月からはかからない', () => {
    const p = person('1961-05-10', '2020-04-01');
    expect(coverageForMonth(p, '2026-04').care).toBe(true);
    expect(coverageForMonth(p, '2026-05').care).toBe(false);
  });

  it('健康保険に加入していなければかからない', () => {
    const p = person('1980-06-10', '2020-04-01');
    p.health.enrolled = false;
    expect(coverageForMonth(p, '2026-04').care).toBe(false);
  });
});

describe('年齢による喪失', () => {
  it('厚生年金は70歳到達月から外れる', () => {
    const p = person('1956-08-20', '2020-04-01');
    expect(coverageForMonth(p, '2026-07').pension).toBe(true);
    expect(coverageForMonth(p, '2026-08').pension).toBe(false);
  });

  it('健康保険は75歳の誕生月から外れる（1日生まれでも誕生月）', () => {
    const p = person('1951-09-01', '2020-04-01');
    expect(coverageForMonth(p, '2026-08').health).toBe(true);
    expect(coverageForMonth(p, '2026-09').health).toBe(false);
  });
});

describe('年度の月', () => {
  it('4月始まり・翌3月終わりの12か月', () => {
    const months = fiscalYearMonths(2026);
    expect(months.length).toBe(12);
    expect(months[0]).toBe('2026-04');
    expect(months[11]).toBe('2027-03');
  });
});