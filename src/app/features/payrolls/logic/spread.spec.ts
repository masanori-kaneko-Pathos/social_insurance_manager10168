import { emptyPayrollInput, Payroll, PayrollLine } from '../../../core/models/payroll';
import { GRADES, healthGradeOf, pensionGradeOf } from './grades.fixture';
import { findStartMonths, judgeIrregular } from './irregular';
import { allocateOtherMonths, readLines, toDrafts, totalsOf } from './payroll-lines';
import type { Remuneration } from './regular';
import { floorSum, forWindow, incomingDelta, incomingParts, partsOf, spreadMonthsOf, wholeShare } from './spread';

// まとめて払った定期代の月割り（日本年金機構「疑義照会回答（厚生年金保険 適用）」月額変更届 3・4・15。台帳 R106。11/26）

const L = (name: string, category: PayrollLine['category'], amount: number, months?: number): PayrollLine =>
  months ? { name, category, amount, months } : { name, category, amount };

/** 内訳から1か月分の実績を作る（画面で保存したときと同じ計算） */
function month(m: string, lines: PayrollLine[], days = 30): [string, Payroll] {
  const t = totalsOf(lines, 'monthly');
  return [
    m,
    { ...emptyPayrollInput(), officeId: 'o', employeeId: 'e', paidMonth: m, cash: t.cash, fixed: t.fixed, retro: t.retro, fixedFull: t.fixedFull, days, lines },
  ];
}

const base = (amount = 200000) => L('基本給', 'base', amount);
const cashOf = (p: ReadonlyMap<string, Payroll>, ms: string[]) => ms.map((m) => p.get(m)!.cash);

describe('まとめて払った定期代（何か月分）', () => {
  it('何か月分を持てるのは通勤手当だけ。本来の月とは一緒に持たない', () => {
    expect(spreadMonthsOf({ category: 'commute', months: 6 })).toBe(6);
    expect(spreadMonthsOf({ category: 'commute', months: 1 })).toBe(1);
    expect(spreadMonthsOf({ category: 'commute', months: null })).toBe(1);
    expect(spreadMonthsOf({ category: 'fixedAllowance', months: 6 })).toBe(1);
    expect(spreadMonthsOf({ category: 'commute', months: 6, forMonth: '2026-04' })).toBe(1);
    expect(spreadMonthsOf({ category: 'commute', months: 13 })).toBe(1);
  });

  it('readLines・toDrafts：何か月分は通勤手当の行にだけ残る', () => {
    const r = readLines([
      { name: '通勤手当', category: 'commute', amount: '42,340', months: 6 },
      { name: '住宅手当', category: 'fixedAllowance', amount: '10,000', months: 6 },
      { name: '通勤手当（1か月）', category: 'commute', amount: '7,000', months: 1 },
    ]);
    expect(r.lines).toEqual([L('通勤手当', 'commute', 42340, 6), L('住宅手当', 'fixedAllowance', 10000), L('通勤手当（1か月）', 'commute', 7000)]);
    expect(toDrafts(r.lines!)[0].months).toBe(6);
  });

  it('totalsOf：総支給額には払った額の全部、固定的賃金にはこの月の分（切り捨て）だけ', () => {
    const t = totalsOf([base(), L('通勤手当', 'commute', 42340, 6)], 'monthly');
    expect(t.cash).toBe(242340); // 給与ソフトの支給総額と同じ
    expect(t.fixed).toBe(207056);
    expect(t.fixedFull).toBe(207056);
    expect(t.nonFixed).toBe(0);
    expect(t.spreadLater).toBe(35284); // 42,340 − 7,056
  });

  it('月額変更届 4：2月に渡した6か月分 30,000円は、券面の期間（4〜9月）ではなく支給した2〜7月に 5,000円ずつ', () => {
    const p = new Map([
      month('2011-01', [base()]),
      month('2011-02', [base(), L('通勤定期', 'commute', 30000, 6)]),
      ...['2011-03', '2011-04', '2011-05', '2011-06', '2011-07', '2011-08'].map((m) => month(m, [base()])),
    ]);
    const a = allocateOtherMonths(p).payrolls;
    expect(cashOf(a, ['2011-01', '2011-02', '2011-03', '2011-07', '2011-08'])).toEqual([200000, 205000, 205000, 205000, 200000]);
    // 起算月は支給した月（月額変更届 3）
    expect(findStartMonths(a).map((s) => s.month)).toEqual(['2011-02', '2011-08']);
  });

  it('月額変更届 15 の 1：1月に6か月分 42,340円 → 各月 7,056円（円未満は切り捨て。4月の月変も7月の算定も同じ）', () => {
    const p = new Map(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].map((m, i) => month(m, i === 0 ? [base(), L('通勤手当', 'commute', 42340, 6)] : [base()])));
    const a = allocateOtherMonths(p).payrolls;
    // 4月月額変更時の扱い（1〜3月）
    expect(cashOf(forWindow(a, ['2026-01', '2026-02', '2026-03']), ['2026-01', '2026-02', '2026-03'])).toEqual([207056, 207056, 207056]);
    // 7月算定基礎時の扱い（4〜6月）
    expect(cashOf(forWindow(a, ['2026-04', '2026-05', '2026-06']), ['2026-04', '2026-05', '2026-06'])).toEqual([207056, 207056, 207056]);
  });

  it('月額変更届 15 の 2：端数の出るものが複数あれば、端数のまま足してから切り捨て（200,000＋7,056.66…＋41,666.66… → 248,723円）', () => {
    // 年4回以上の賞与 500,000円 ÷ 12 も、割った額として同じ足し方をする
    expect(200000 + floorSum([{ amount: 42340, months: 6 }, { amount: 500000, months: 12 }])).toBe(248723);
    // 手当ごとに切り捨てると 1円ずれる（200,000＋7,056＋41,666 ＝ 248,722）
    expect(200000 + Math.floor(42340 / 6) + Math.floor(500000 / 12)).toBe(248722);
  });

  it('月額変更届 15 の 2（定期代どうし）：前の月の6か月分と、この月の3か月分も端数のまま足す', () => {
    const p = new Map([
      month('2026-03', [base(), L('通勤定期A', 'commute', 42340, 6)]),
      month('2026-04', [base(), L('通勤定期B', 'commute', 10000, 3)]),
    ]);
    const a = allocateOtherMonths(p).payrolls;
    // 4月：7,056.66… ＋ 3,333.33… ＝ 10,390 → 210,390円（別々に切り捨てると 210,389円）
    expect(a.get('2026-04')!.cash).toBe(210390);
    expect(a.get('2026-04')!.fixed).toBe(210390);
  });

  it('月額変更届 15 の 3：4月に3か月分 10,000円 → 4〜6月で平均を出すときは 3,334・3,333・3,333円（総額を変えない）', () => {
    const p = new Map(['2026-04', '2026-05', '2026-06', '2026-07'].map((m, i) => month(m, i === 0 ? [base(), L('通勤手当', 'commute', 10000, 3)] : [base()])));
    const a = allocateOtherMonths(p).payrolls;
    const win = forWindow(a, ['2026-04', '2026-05', '2026-06']);
    expect(cashOf(win, ['2026-04', '2026-05', '2026-06'])).toEqual([203334, 203333, 203333]);
    expect(cashOf(win, ['2026-04', '2026-05', '2026-06']).reduce((s, v) => s + v, 0)).toBe(610000);
    // 全部が入らない3か月（5〜7月）は、切り捨てのまま
    expect(cashOf(forWindow(a, ['2026-05', '2026-06', '2026-07']), ['2026-05', '2026-06', '2026-07'])).toEqual([203333, 203333, 200000]);
    expect(wholeShare({ paidMonth: '2026-04', amount: 10000, months: 3 }, '2026-07')).toBe(0);
  });

  it('随時改定：4月に3か月分を払い始めた人は、4〜6月の総額で平均を出す', () => {
    const rem200: Remuneration = {
      from: '2025-09',
      reason: 'regular',
      monthlyAmount: 200000,
      health: { grade: healthGradeOf(200), standard: 200000 },
      pension: { grade: pensionGradeOf(200), standard: 200000 },
    };
    const p = new Map([
      month('2026-03', [base()]),
      month('2026-04', [base(), L('通勤手当', 'commute', 10000, 3)]),
      month('2026-05', [base()], 31),
      month('2026-06', [base()]),
      month('2026-07', [base(), L('通勤手当', 'commute', 10000, 3)]),
    ]);
    const a = allocateOtherMonths(p).payrolls;
    const start = findStartMonths(a).find((s) => s.month === '2026-04')!;
    const r = judgeIrregular({ start, payrolls: a, remunerations: [rem200], gradesAt: () => GRADES, minDaysAt: () => 17, pensionAt: () => true });
    expect(r.months.map((m) => m.amount)).toEqual([203334, 203333, 203333]);
    expect(r.average!.total).toBe(610000);
  });

  it('割り振る月の実績がまだない月は数えない。元の実績は書き換えない', () => {
    const p = new Map([month('2026-10', [base(), L('通勤手当', 'commute', 60000, 6)])]);
    const { payrolls, moved } = allocateOtherMonths(p);
    expect(payrolls.get('2026-10')!.cash).toBe(210000);
    expect([...moved]).toEqual([['2026-10', -50000]]);
    expect(p.get('2026-10')!.cash).toBe(260000);
  });

  it('次の月の内訳に出す「月割り」と、固定的賃金に足す額', () => {
    const p = new Map([month('2026-01', [base(), L('通勤手当', 'commute', 42340, 6)]), month('2026-02', [base()])]);
    const inc = incomingParts(p, '2026-03');
    expect(inc).toEqual([{ paidMonth: '2026-01', name: '通勤手当', amount: 42340, months: 6 }]);
    expect(incomingDelta([], inc)).toBe(7056);
    expect(incomingParts(p, '2026-07')).toEqual([]);
    // この月にも3か月分を払ったとき：端数のまま足した額 − この月の分
    const own = partsOf([L('通勤定期B', 'commute', 10000, 3)], '2026-03');
    expect(incomingDelta(own, inc)).toBe(10390 - 3333);
  });
});
