import { emptyPayrollInput, Payroll } from '../../../core/models/payroll';
import { employedDuring, hasExtra, insuredDuring, latestPaidMonth, missingPayrolls, PayrollEmployee, payrollRows, periodOf, PaySchedule, suggestDays, validatePayroll } from './payroll-rows';
import { shiftMonth, daysInclusive } from '../../../shared/utils/date';

// 伊藤テスト中商事：月末締め・翌月25日払い
const MONTH_END_NEXT: PaySchedule = { closingDay: 31, payDay: 25, payMonth: 'next' };

function emp(
  id: string,
  hireDate: string,
  retireDate: string | null,
  lostDate: string | null = null,
): PayrollEmployee {
  const en = { enrolled: true, acquiredDate: hireDate, lostDate };
  return { id, hireDate, retireDate, health: { ...en }, pension: { ...en } };
}

// テストデータ（引き継ぎメモ 10章）
const A = emp('A', '2024-04-01', null);
const D = emp('D', '2020-04-01', '2026-08-20', '2026-08-21');
const F = emp('F', '2026-06-10', '2026-06-25', '2026-06-26');

describe('shiftMonth / daysInclusive', () => {
  it('年をまたぐ', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
  it('両端を含む', () => {
    expect(daysInclusive('2026-10-01', '2026-10-31')).toBe(31);
    expect(daysInclusive('2026-06-10', '2026-06-10')).toBe(1);
  });
});

describe('periodOf（支払った月 → 対象期間）', () => {
  it('月末締め・翌月払い：11月払いは10月分', () => {
    expect(periodOf('2026-11', MONTH_END_NEXT)).toEqual({ start: '2026-10-01', end: '2026-10-31' });
  });
  it('月末締め・翌月払い：3月払いは2月分（うるう年でない）', () => {
    expect(periodOf('2027-03', MONTH_END_NEXT)).toEqual({ start: '2027-02-01', end: '2027-02-28' });
  });
  it('20日締め・翌月払い', () => {
    const s: PaySchedule = { closingDay: 20, payDay: 10, payMonth: 'next' };
    expect(periodOf('2026-11', s)).toEqual({ start: '2026-09-21', end: '2026-10-20' });
  });
  it('25日締め・当月払い', () => {
    const s: PaySchedule = { closingDay: 25, payDay: 25, payMonth: 'current' };
    expect(periodOf('2026-11', s)).toEqual({ start: '2026-10-26', end: '2026-11-25' });
  });
  it('30日締め：2月は末日で止め、3月は3/1から', () => {
    const s: PaySchedule = { closingDay: 30, payDay: 10, payMonth: 'next' };
    expect(periodOf('2027-03', s)).toEqual({ start: '2027-01-31', end: '2027-02-28' });
    expect(periodOf('2027-04', s)).toEqual({ start: '2027-03-01', end: '2027-03-30' });
  });
});

describe('latestPaidMonth（実績が入っているべき月）', () => {
  it('支払日の前なら先月', () => {
    expect(latestPaidMonth('2026-11-06', MONTH_END_NEXT)).toBe('2026-10');
  });
  it('支払日の当日からは今月', () => {
    expect(latestPaidMonth('2026-11-25', MONTH_END_NEXT)).toBe('2026-11');
  });
  it('月末払い（31）は、30日の月は30日から', () => {
    const s: PaySchedule = { closingDay: 31, payDay: 31, payMonth: 'current' };
    expect(latestPaidMonth('2026-11-29', s)).toBe('2026-10');
    expect(latestPaidMonth('2026-11-30', s)).toBe('2026-11');
  });
});

describe('在籍・加入と、日数の候補', () => {
  it('テスト四郎（8/20退職）：9月払い（8月分）には出て、10月払いには出ない', () => {
    expect(employedDuring(D, periodOf('2026-09', MONTH_END_NEXT))).toBeTrue();
    expect(employedDuring(D, periodOf('2026-10', MONTH_END_NEXT))).toBeFalse();
  });
  it('テスト四郎：9月払いの日数の候補は 8/1〜8/20 の20日', () => {
    expect(suggestDays(D, periodOf('2026-09', MONTH_END_NEXT))).toBe(20);
  });
  it('テスト六郎（6/10〜6/25）：7月払いの日数の候補は16日', () => {
    expect(suggestDays(F, periodOf('2026-07', MONTH_END_NEXT))).toBe(16);
  });
  it('テスト一郎：11月払い（10月分）は31日', () => {
    expect(suggestDays(A, periodOf('2026-11', MONTH_END_NEXT))).toBe(31);
  });
  it('未加入の人は在籍していても加入していない', () => {
    const notInsured: PayrollEmployee = {
      ...A,
      id: 'P',
      health: { enrolled: false, acquiredDate: null, lostDate: null },
      pension: { enrolled: false, acquiredDate: null, lostDate: null },
    };
    const p = periodOf('2026-11', MONTH_END_NEXT);
    expect(employedDuring(notInsured, p)).toBeTrue();
    expect(insuredDuring(notInsured, p)).toBeFalse();
  });
  it('喪失日が期間の初日なら、その期間は加入していない', () => {
    const lostOnFirst = emp('L', '2020-04-01', '2026-09-30', '2026-10-01');
    expect(insuredDuring(lostOnFirst, periodOf('2026-11', MONTH_END_NEXT))).toBeFalse();
  });
});

describe('payrollRows / missingPayrolls', () => {
  const saved = new Map<string, Payroll>([
    [
      'A',
      { ...emptyPayrollInput(), officeId: 'o', employeeId: 'A', paidMonth: '2026-09', cash: 320000, fixed: 320000, days: 31 },
    ],
  ]);
  const p = periodOf('2026-09', MONTH_END_NEXT); // 8月分

  it('在籍していた人だけ。途中で退職した四郎は partial', () => {
    const rows = payrollRows([A, D, F], p, saved);
    expect(rows.map((r) => r.employeeId)).toEqual(['A', 'D']);
    expect(rows[0].saved?.cash).toBe(320000);
    expect(rows[0].partial).toBeFalse();
    expect(rows[1].saved).toBeNull();
    expect(rows[1].partial).toBeTrue();
    expect(rows[1].suggestedDays).toBe(20);
  });

  it('入れ忘れ：加入していて実績がない人', () => {
    expect(missingPayrolls([A, D, F], p, saved)).toEqual(['D']);
  });
});

describe('validatePayroll', () => {
  const ok = { ...emptyPayrollInput(), cash: 330000, fixed: 300000, days: 31 };

  it('問題なし', () => {
    expect(validatePayroll(ok, 31)).toEqual([]);
  });
  it('固定的賃金が通貨の額より大きい', () => {
    expect(validatePayroll({ ...ok, fixed: 330001 }, 31)).toEqual(['fixedOverCash']);
  });
  it('遡及支払額は現物を含めた合計まで', () => {
    expect(validatePayroll({ ...ok, inKind: 10000, retro: 340000 }, 31)).toEqual([]);
    expect(validatePayroll({ ...ok, inKind: 10000, retro: 340001 }, 31)).toEqual(['retroOverTotal']);
  });
  it('日数は対象期間の日数まで', () => {
    expect(validatePayroll({ ...ok, days: 31 }, 30)).toEqual(['daysOutOfRange']);
  });
  it('小数・負の数', () => {
    expect(validatePayroll({ ...ok, cash: 1.5 }, 31)).toEqual(['notInteger']);
    expect(validatePayroll({ ...ok, days: -1 }, 31)).toEqual(['daysOutOfRange']);
  });
  it('実労働時間の上限（31日 × 24時間）', () => {
    expect(validatePayroll({ ...ok, workMinutes: 44640 }, 31)).toEqual([]);
    expect(validatePayroll({ ...ok, workMinutes: 44641 }, 31)).toEqual(['minutesOutOfRange']);
  });
});

describe('hasExtra', () => {
  it('隠れた列に値があれば true', () => {
    expect(hasExtra(emptyPayrollInput())).toBeFalse();
    expect(hasExtra({ ...emptyPayrollInput(), retro: 5000 })).toBeTrue();
    expect(hasExtra({ ...emptyPayrollInput(), state: 'suspended' })).toBeTrue();
  });
});
