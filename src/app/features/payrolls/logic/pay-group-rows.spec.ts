import { PayrollEmployee, payrollRowsFor, PaySchedule } from './payroll-rows';
import { payrollExportRows, scheduleFor } from './payroll-csv';

// 給与の支払区分：月給は月末締め翌月25日払い、パートは15日締め当月末日払い（11/24）
const MONTHLY: PaySchedule = { closingDay: 31, payDay: 25, payMonth: 'next' };
const PART: PaySchedule = { closingDay: 15, payDay: 31, payMonth: 'current' };

function emp(id: string, hireDate: string, retireDate: string | null = null): PayrollEmployee {
  const en = { enrolled: true, acquiredDate: hireDate, lostDate: null };
  return { id, hireDate, retireDate, health: { ...en }, pension: { ...en } };
}

const A = emp('A', '2020-04-01');
const P = emp('P', '2020-04-01');
// 10/10 退職：月給の11月払い（10/1〜10/31）には出る。パートの11月払い（10/16〜11/15）には出ない
const Q = emp('Q', '2020-04-01', '2026-10-10');
const schedule = (e: { id: string }) => (e.id === 'A' ? MONTHLY : PART);

describe('payrollRowsFor（給与の支払区分ごとの対象期間）', () => {
  const rows = payrollRowsFor([A, P, Q], '2026-11', schedule, new Map());

  it('人ごとに、その人の区分の対象期間になる', () => {
    expect(rows.find((r) => r.employeeId === 'A')!.period).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(rows.find((r) => r.employeeId === 'P')!.period).toEqual({ start: '2026-10-16', end: '2026-11-15' });
  });
  it('並びは渡した従業員の順', () => {
    expect(rows.map((r) => r.employeeId)).toEqual(['A', 'P']);
  });
  it('パートの区分で 10/10 に退職した人は、11月払い（10/16〜）に出ない', () => {
    expect(rows.some((r) => r.employeeId === 'Q')).toBeFalse();
  });
  it('給与計算の基礎日数の候補も、その人の対象期間の日数（パートは31日）', () => {
    expect(rows.find((r) => r.employeeId === 'P')!.suggestedDays).toBe(31);
  });
});

describe('給与の CSV：人ごとの区分', () => {
  it('scheduleFor は、区分1つでも関数でも使える', () => {
    expect(scheduleFor(MONTHLY, 'P', '2026-11')).toEqual(MONTHLY);
    expect(scheduleFor((id) => (id === 'P' ? PART : MONTHLY), 'P', '2026-11')).toEqual(PART);
  });
  it('出力する行：在籍の判定は、その人の区分の対象期間', () => {
    // 10/10 退職：月給の区分なら11月払い（10月分）に出る。パートの区分なら出ない
    const q = { ...Q, employeeNumber: '9', lastName: 'テスト', firstName: '九郎' };
    const asMonthly = payrollExportRows([q], [], ['2026-11'], MONTHLY);
    const asPart = payrollExportRows([q], [], ['2026-11'], () => PART);
    expect(asMonthly.length).toBe(1);
    expect(asPart.length).toBe(0);
  });
});
