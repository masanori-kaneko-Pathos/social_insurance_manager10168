import { fiscalStart, monthsOfPeriod, sumPeriod, PeriodMonth } from './period-totals';

describe('期間ごとの会社負担の集計', () => {
  it('期間の月：両端を含む。逆順・24か月を超えるときは null', () => {
    expect(monthsOfPeriod('2026-04', '2026-06')).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(monthsOfPeriod('2026-06', '2026-04')).toBeNull();
    expect(monthsOfPeriod('2024-01', '2025-12')?.length).toBe(24);
    expect(monthsOfPeriod('2024-01', '2026-01')).toBeNull();
  });
  it('今年度の4月', () => {
    expect(fiscalStart('2026-11')).toBe('2026-04');
    expect(fiscalStart('2027-02')).toBe('2026-04');
  });
  it('期間の合計は月の会社負担を足す', () => {
    const m = (month: string, h: number, p: number): PeriodMonth => ({
      month,
      employer: { health: h, pension: p, childContribution: 10 },
      employerTotal: h + p + 10,
      employeeTotal: h + p,
      paymentTotal: 2 * (h + p) + 10,
      hasBonus: false,
      problems: 0,
    });
    const s = sumPeriod([m('2026-04', 100, 200), m('2026-05', 110, 210)]);
    expect(s.employer).toEqual({ health: 210, pension: 410, childContribution: 20 });
    expect(s.employerTotal).toBe(640);
  });
});
