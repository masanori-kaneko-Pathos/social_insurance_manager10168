import { emptyPayrollInput, Payroll } from '../../../core/models/payroll';
import { GRADES, healthGradeOf, pensionGradeOf } from './grades.fixture';
import { judgeLeaveEnd, LeaveEndInput, LeaveEndLeave } from './leave-end';
import type { Remuneration } from './regular';

function pay(month: string, cash: number, days = 31): [string, Payroll] {
  return [month, { ...emptyPayrollInput(), officeId: 'o', employeeId: 'e', paidMonth: month, cash, fixed: cash, days }];
}
function rem(from: string, k: number): Remuneration {
  return {
    from,
    reason: 'regular',
    monthlyAmount: k * 1000,
    health: { grade: healthGradeOf(k), standard: k * 1000 },
    pension: { grade: pensionGradeOf(k), standard: k * 1000 },
  };
}
const childcare = (p: Partial<LeaveEndLeave> = {}): LeaveEndLeave => ({
  kind: 'childcare',
  start: '2025-03-01',
  plannedEnd: '2026-03-31',
  end: null,
  birthDate: null,
  childBirthDate: '2025-01-10',
  ...p,
});
const maternity = (p: Partial<LeaveEndLeave> = {}): LeaveEndLeave => ({
  kind: 'maternity',
  start: '2024-11-20',
  plannedEnd: '2025-02-28',
  end: null,
  birthDate: '2025-01-10',
  childBirthDate: null,
  ...p,
});

function input(leave: LeaveEndLeave, payrolls: [string, Payroll][], p: Partial<LeaveEndInput> = {}): LeaveEndInput {
  return {
    leave,
    allLeaves: [leave],
    payrolls: new Map(payrolls),
    remunerations: [rem('2024-09', 260)],
    gradesAt: () => GRADES,
    minDaysAt: () => 17,
    partAt: () => false,
    pensionAt: () => true,
    ...p,
  };
}

// 3月31日に育休が終わる → 4・5・6月の報酬 → 7月から改定
const AFTER = [pay('2026-04', 200000), pay('2026-05', 200000, 30), pay('2026-06', 200000)];

describe('judgeLeaveEnd：育児休業等終了時改定', () => {
  it('終了日の翌日の月から3か月、4か月目に改定。時短で下がった', () => {
    const r = judgeLeaveEnd(input(childcare(), AFTER))!;
    expect(r.kind).toBe('childcare');
    expect(r.startMonth).toBe('2026-04');
    expect(r.revisedFrom).toBe('2026-07');
    expect(r.average?.average).toBe(200000);
    expect(r.health?.after.standard).toBe(200000);
    expect(r.status).toBe('candidate');
  });
  it('1等級差でも改定（随時改定の2等級とは違う）。上がる場合も候補', () => {
    const one = [pay('2026-04', 260000), pay('2026-05', 260000), pay('2026-06', 245000)];
    // 平均 255,000 → 260千のまま（同じ等級）
    expect(judgeLeaveEnd(input(childcare(), one))!.status).toBe('noGradeDiff');
    const down1 = [pay('2026-04', 245000), pay('2026-05', 245000), pay('2026-06', 245000)];
    expect(judgeLeaveEnd(input(childcare(), down1))!.health?.diff).toBe(-1);
    expect(judgeLeaveEnd(input(childcare(), down1))!.status).toBe('candidate');
    const upward = [pay('2026-04', 300000), pay('2026-05', 300000), pay('2026-06', 300000)];
    expect(judgeLeaveEnd(input(childcare(), upward))!.status).toBe('candidate');
  });
  it('17日未満の月は除いて平均。1か月も基準以上がなければ shortDays', () => {
    const mixed = [pay('2026-04', 120000, 10), pay('2026-05', 200000, 30), pay('2026-06', 210000)];
    const r = judgeLeaveEnd(input(childcare(), mixed))!;
    expect(r.months.map((m) => m.used)).toEqual([false, true, true]);
    expect(r.average?.average).toBe(205000);
    const none = [pay('2026-04', 120000, 10), pay('2026-05', 150000, 16), pay('2026-06', 150000, 15)];
    expect(judgeLeaveEnd(input(childcare(), none))!.status).toBe('shortDays');
  });
  it('パート（短時間就労者）は、3か月とも17日未満なら15日以上の月で平均', () => {
    const none = [pay('2026-04', 120000, 10), pay('2026-05', 150000, 16), pay('2026-06', 160000, 15)];
    const r = judgeLeaveEnd(input(childcare(), none, { partAt: () => true }))!;
    expect(r.months.map((m) => m.used)).toEqual([false, true, true]);
    expect(r.average?.average).toBe(155000);
  });
  it('短時間労働者の月は11日以上なら使える', () => {
    const st = [pay('2026-04', 120000, 12), pay('2026-05', 120000, 12), pay('2026-06', 120000, 12)];
    expect(judgeLeaveEnd(input(childcare(), st, { minDaysAt: () => 11 }))!.months.every((m) => m.used)).toBeTrue();
  });
  it('終了日に子が3歳以上・子の生年月日がない → noChild', () => {
    expect(judgeLeaveEnd(input(childcare({ childBirthDate: '2023-03-01' }), AFTER))!.status).toBe('noChild');
    expect(judgeLeaveEnd(input(childcare({ childBirthDate: null }), AFTER))!.status).toBe('noChild');
  });
  it('出生時育休も育児休業等として扱う。終了日が未定なら判定しない', () => {
    expect(judgeLeaveEnd(input(childcare({ kind: 'paternity' }), AFTER))!.kind).toBe('childcare');
    expect(judgeLeaveEnd(input(childcare({ plannedEnd: null }), AFTER))).toBeNull();
  });
  it('実際の終了日があれば、そちらを使う', () => {
    const r = judgeLeaveEnd(input(childcare({ end: '2026-02-15' }), [pay('2026-02', 1), pay('2026-03', 1), pay('2026-04', 1)]))!;
    expect(r.startMonth).toBe('2026-02');
    expect(r.revisedFrom).toBe('2026-05');
  });
});

describe('judgeLeaveEnd：産前産後休業終了時改定', () => {
  const after = [pay('2025-03', 200000), pay('2025-04', 200000, 30), pay('2025-05', 200000)];
  it('産休のあと育休を取らずに時短で復帰 → 候補', () => {
    const r = judgeLeaveEnd(input(maternity(), after))!;
    expect(r.kind).toBe('maternity');
    expect(r.revisedFrom).toBe('2025-06');
    expect(r.status).toBe('candidate');
  });
  it('産休の翌日に続けて育休を始めたら出せない', () => {
    const m = maternity();
    const c = childcare({ start: '2025-03-01' });
    expect(judgeLeaveEnd(input(m, after, { allLeaves: [m, c] }))!.status).toBe('followedByChildcare');
  });
  it('出産日が入っていなければ noChild', () => {
    expect(judgeLeaveEnd(input(maternity({ birthDate: null }), after))!.status).toBe('noChild');
  });
});
