import { emptyPayrollInput, Payroll } from '../../../core/models/payroll';
import type { GradeTableDoc } from '../../../core/models/rates';
import { HEALTH_ROWS, PENSION_ROWS, healthGradeOf, pensionGradeOf } from './grades.fixture';
import type { Remuneration } from './regular';
import { groupOf, RevisionContext, RevisionPerson, revisionItems } from './revision-rows';

const TABLES = [
  { kind: 'health', from: '2024-03', grades: HEALTH_ROWS },
  { kind: 'pension', from: '2024-03', grades: PENSION_ROWS },
] as unknown as GradeTableDoc[];

const CTX: RevisionContext = {
  office: { standardHours: { weeklyMinutes: 2400, monthlyDays: 20 }, specificApplication: { since: '2024-10' } },
  criteria: [{ from: '2026-10', weeklyMinutesMin: 1200, wageMin: null, reducedWageMin: 88000 }],
  schedule: { closingDay: 31, payDay: 25, payMonth: 'next' }, // 月末締め・翌月25日払い
  gradeTables: TABLES,
  fromMonth: '2025-01',
};

function pay(month: string, cash: number, fixed: number, days: number): [string, Payroll] {
  return [month, { ...emptyPayrollInput(), officeId: 'o', employeeId: 'A', paidMonth: month, cash, fixed, days }];
}
function rem(from: string, k: number): Remuneration {
  return {
    from,
    reason: 'acquisition',
    monthlyAmount: k * 1000,
    health: { grade: healthGradeOf(k), standard: k * 1000 },
    pension: { grade: pensionGradeOf(k), standard: k * 1000 },
  };
}
const enr = { enrolled: true, acquiredDate: '2026-10-01', lostDate: null, lossReason: null };

/** 週20時間のパート（4分の3未満 → 短時間労働者） */
function partTimer(p: Partial<RevisionPerson> = {}): RevisionPerson {
  return {
    employee: {
      id: 'A',
      birthDate: '1990-05-15',
      health: enr,
      pension: enr,
      optInDate: null,
      optOutDate: null,
      leaves: [],
    },
    contracts: [
      {
        from: '2026-10-01',
        employmentType: 'part',
        weeklyMinutes: 1200,
        monthlyDays: 12,
        scheduledWage: 100000,
        periodEnd: null,
        renewal: 'none',
        student: 'none',
        minimumWageReduction: false,
      },
    ],
    payrolls: new Map([
      pay('2026-11', 100000, 100000, 12),
      pay('2026-12', 160000, 160000, 12), // 時給が上がった
      pay('2027-01', 160000, 160000, 12),
      pay('2027-02', 160000, 160000, 12),
    ]),
    remunerations: [rem('2026-10', 98)],
    ...p,
  };
}

describe('revisionItems：月ごとの区分で支払基礎日数の基準を決める', () => {
  it('短時間労働者の月は11日以上でよい → 12日でも随時改定の候補', () => {
    const items = revisionItems(partTimer(), CTX);
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('irregular');
    expect(items[0].result.status).toBe('candidate');
    expect(items[0].result.revisedFrom).toBe('2027-03');
    expect(groupOf(items[0])).toBe('candidate');
  });
  it('同じ人が4分の3以上（通常の労働者）なら17日が要るので shortDays', () => {
    const p = partTimer();
    p.contracts = [{ ...p.contracts[0], weeklyMinutes: 2400, monthlyDays: 20 }];
    expect(revisionItems(p, CTX)[0].result.status).toBe('shortDays');
  });
  it('改定する月の標準報酬がもうあれば「反映済み」', () => {
    const p = partTimer({ remunerations: [rem('2026-10', 98), rem('2027-03', 160)] });
    expect(groupOf(revisionItems(p, CTX)[0])).toBe('reflected');
  });
  it('出し始める月より前の起算月は出さない', () => {
    expect(revisionItems(partTimer(), { ...CTX, fromMonth: '2027-01' })).toEqual([]);
  });
  it('健保にも厚年にも入っていない人は出さない', () => {
    const p = partTimer();
    const off = { enrolled: false, acquiredDate: null, lostDate: null, lossReason: null };
    p.employee = { ...p.employee, health: off, pension: off };
    expect(revisionItems(p, CTX)).toEqual([]);
  });
});
