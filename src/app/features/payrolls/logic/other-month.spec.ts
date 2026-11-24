import { emptyPayrollInput, Payroll, PayrollLine } from '../../../core/models/payroll';
import { GRADES, healthGradeOf, pensionGradeOf } from './grades.fixture';
import { findStartMonths, judgeIrregular } from './irregular';
import { allocateOtherMonths, readLines, totalsOf } from './payroll-lines';
import type { Remuneration } from './regular';

// 遡及払いがあったときの随時改定の起算月（日本年金機構の月額変更届の記入例。11/24）
// ① 遡って決まった昇給の差額 → 実際に払った月が起算月、差額は除いて平均（修正平均額）
// ② 払い忘れ・計算誤りの精算 → 本来払う月が起算月、遅れて払った分は本来の月に割り振る

const L = (name: string, category: PayrollLine['category'], amount: number, forMonth?: string): PayrollLine =>
  forMonth ? { name, category, amount, forMonth } : { name, category, amount };

/** 内訳から1か月分の実績を作る（画面で保存したときと同じ計算） */
function month(m: string, lines: PayrollLine[], days = 30): [string, Payroll] {
  const t = totalsOf(lines, 'monthly');
  return [
    m,
    { ...emptyPayrollInput(), officeId: 'o', employeeId: 'e', paidMonth: m, cash: t.cash, fixed: t.fixed, retro: t.retro, fixedFull: t.fixedFull, days, lines },
  ];
}

const rem200: Remuneration = {
  from: '2025-09',
  reason: 'regular',
  monthlyAmount: 200000,
  health: { grade: healthGradeOf(200), standard: 200000 },
  pension: { grade: pensionGradeOf(200), standard: 200000 },
};

function judge(payrolls: Map<string, Payroll>, startMonth: string) {
  const start = findStartMonths(payrolls).find((s) => s.month === startMonth)!;
  return judgeIrregular({
    start,
    payrolls,
    remunerations: [rem200],
    gradesAt: () => GRADES,
    minDaysAt: () => 17,
    pensionAt: () => true,
  });
}

describe('本来の月（払い忘れの精算）', () => {
  it('totalsOf：総支給額には入れるが、この月の固定的賃金・非固定的賃金には入れない', () => {
    const t = totalsOf([L('基本給', 'base', 200000), L('家族手当', 'fixedAllowance', 10000), L('家族手当（4月分）', 'fixedAllowance', 10000, '2026-04')], 'monthly');
    expect(t.cash).toBe(220000);
    expect(t.fixed).toBe(210000);
    expect(t.nonFixed).toBe(0);
    expect(t.otherMonth).toBe(10000);
  });

  it('readLines：本来の月は行に残る（遡及支払額・報酬にならない分類には付けない）', () => {
    const r = readLines([
      { name: '家族手当（4月分）', category: 'fixedAllowance', amount: '10,000', forMonth: '2026-04' },
      { name: '昇給差額', category: 'retro', amount: '40,000', forMonth: '2026-04' },
    ]);
    expect(r.lines).toEqual([L('家族手当（4月分）', 'fixedAllowance', 10000, '2026-04'), L('昇給差額', 'retro', 40000)]);
  });

  it('allocateOtherMonths：本来の月へ移す。本来の月の実績がなければ残して知らせる', () => {
    const src = new Map([
      month('2026-04', [L('基本給', 'base', 200000)]),
      month('2026-05', [L('基本給', 'base', 200000), L('家族手当', 'fixedAllowance', 10000), L('家族手当（4月分）', 'fixedAllowance', 10000, '2026-04'), L('残業', 'variable', 5000, '2026-03')]),
    ]);
    const { payrolls, unplaced } = allocateOtherMonths(src);
    expect(payrolls.get('2026-04')!.cash).toBe(210000);
    expect(payrolls.get('2026-04')!.fixed).toBe(210000);
    expect(payrolls.get('2026-05')!.cash).toBe(215000); // 3月分の残業は3月の実績がないので残る
    expect(unplaced).toEqual([{ paidMonth: '2026-05', forMonth: '2026-03', amount: 5000 }]);
    expect([...allocateOtherMonths(src).moved]).toEqual([['2026-05', -10000], ['2026-04', 10000]]);
    expect(src.get('2026-04')!.cash).toBe(200000); // 元の実績は書き換えない
  });

  it('記入例①：昇給差額（遡及支払額）→ 5月が起算月、修正平均額 240,000円', () => {
    const p = new Map([
      month('2026-03', [L('基本給', 'base', 200000)]),
      month('2026-04', [L('基本給', 'base', 200000)]),
      month('2026-05', [L('基本給', 'base', 240000), L('昇給差額', 'retro', 40000)]),
      month('2026-06', [L('基本給', 'base', 240000)], 31),
      month('2026-07', [L('基本給', 'base', 240000)]),
    ]);
    const r = judge(allocateOtherMonths(p).payrolls, '2026-05');
    expect(r.average!.total).toBe(760000);
    expect(r.average!.average).toBe(253333);
    expect(r.average!.corrected).toBe(240000);
    expect(r.revisedFrom).toBe('2026-08');
  });

  it('記入例②：家族手当の払い忘れ → 4月が起算月、4月 238,000円・5月 210,000円に割り振り、平均 230,333円で改定', () => {
    const p = new Map([
      month('2026-03', [L('基本給', 'base', 200000)]),
      month('2026-04', [L('基本給', 'base', 200000), L('残業手当', 'variable', 28000)], 31),
      month('2026-05', [L('基本給', 'base', 200000), L('家族手当', 'fixedAllowance', 10000), L('家族手当（4月分）', 'fixedAllowance', 10000, '2026-04')]),
      month('2026-06', [L('基本給', 'base', 200000), L('家族手当', 'fixedAllowance', 10000), L('残業手当', 'variable', 33000)], 31),
      month('2026-07', [L('基本給', 'base', 200000), L('家族手当', 'fixedAllowance', 10000)]),
    ]);
    const allocated = allocateOtherMonths(p).payrolls;
    expect(findStartMonths(allocated).map((s) => s.month)).toEqual(['2026-04']);
    const r = judge(allocated, '2026-04');
    expect(r.months.map((m) => m.amount)).toEqual([238000, 210000, 243000]);
    expect(r.average!.average).toBe(230333);
    expect(r.health!.revise).toBeTrue(); // 200千円 → 240千円（2等級差）
    expect(r.revisedFrom).toBe('2026-07');
  });

  it('割り振らないと記入例②は5月起算・1等級差で見落とす（割り振りが要る理由）', () => {
    const p = new Map([
      month('2026-03', [L('基本給', 'base', 200000)]),
      month('2026-04', [L('基本給', 'base', 200000), L('残業手当', 'variable', 28000)], 31),
      month('2026-05', [L('基本給', 'base', 200000), L('家族手当', 'fixedAllowance', 10000), L('家族手当（差額）', 'fixedAllowance', 10000)]),
      month('2026-06', [L('基本給', 'base', 200000), L('家族手当', 'fixedAllowance', 10000), L('残業手当', 'variable', 33000)], 31),
      month('2026-07', [L('基本給', 'base', 200000), L('家族手当', 'fixedAllowance', 10000)]),
    ]);
    expect(findStartMonths(p)[0].month).toBe('2026-05');
  });
});
