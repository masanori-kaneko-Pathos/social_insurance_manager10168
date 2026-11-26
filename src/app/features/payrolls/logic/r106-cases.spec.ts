import { emptyPayrollInput, Payroll, PayrollLine } from '../../../core/models/payroll';
import { GRADES, healthGradeOf, pensionGradeOf } from './grades.fixture';
import { contractStartMonths, findStartMonths, furloughEndAllowed, judgeIrregular } from './irregular';
import { dayRulesOf } from './revision-rows';
import { judgeLeaveEnd, LeaveEndLeave } from './leave-end';
import { totalsOf } from './payroll-lines';
import { decideRegular, july1PayOf, Remuneration } from './regular';

// 日本年金機構「疑義照会回答（厚生年金保険 適用）」（台帳 R106）の各件を、アプリの判定と突き合わせる（11/26）
// 事務取扱いの事例集を spec にしたのと同じやり方。ここは「今のアプリで合っている」件

const L = (name: string, category: PayrollLine['category'], amount: number, over: Partial<PayrollLine> = {}): PayrollLine => ({ name, category, amount, ...over });

/** 内訳から1か月分の実績を作る（画面で保存したときと同じ計算） */
function month(m: string, lines: PayrollLine[], over: Partial<Payroll> = {}): [string, Payroll] {
  const t = totalsOf(lines, 'monthly');
  return [
    m,
    { ...emptyPayrollInput(), officeId: 'o', employeeId: 'e', paidMonth: m, cash: t.cash, fixed: t.fixed, retro: t.retro, fixedFull: t.fixedFull, days: 30, lines, ...over },
  ];
}
const pay = (m: string, cash: number, over: Partial<Payroll> = {}): [string, Payroll] => [
  m,
  { ...emptyPayrollInput(), officeId: 'o', employeeId: 'e', paidMonth: m, cash, fixed: cash, days: 31, ...over },
];
const rem = (from: string, k: number): Remuneration => ({
  from,
  reason: 'regular',
  monthlyAmount: k * 1000,
  health: { grade: healthGradeOf(k), standard: k * 1000 },
  pension: { grade: pensionGradeOf(k), standard: k * 1000 },
});
const starts = (p: Map<string, Payroll>, opts?: Parameters<typeof findStartMonths>[2]) => findStartMonths(p, [], opts).map((s) => s.month);

describe('疑義照会回答（月額変更届）：今のアプリで合っている件', () => {
  it('9・10：固定的賃金の変動が給与に出る月がそれぞれ違えば、それぞれの月を起算月にする（10月：役職手当の増、11月：通勤手当の減が1か月分）', () => {
    const p = new Map([
      month('2026-09', [L('基本給', 'base', 300000), L('役職手当', 'fixedAllowance', 10000), L('通勤手当', 'commute', 10000)]),
      month('2026-10', [L('基本給', 'base', 300000), L('役職手当', 'fixedAllowance', 20000), L('通勤手当', 'commute', 8000)]),
      month('2026-11', [L('基本給', 'base', 300000), L('役職手当', 'fixedAllowance', 20000), L('通勤手当', 'commute', 5000)]),
      month('2026-12', [L('基本給', 'base', 300000), L('役職手当', 'fixedAllowance', 20000), L('通勤手当', 'commute', 5000)]),
    ]);
    expect(starts(p)).toEqual(['2026-10', '2026-11']);
  });

  it('11：残業手当の支払日が翌月払いに変わっただけでは起算月にしない（基本給が変わった1月だけ）', () => {
    const p = new Map([
      month('2026-12', [L('基本給', 'base', 200000), L('残業手当', 'variable', 20000)]),
      month('2027-01', [L('基本給', 'base', 210000)]), // 残業手当は翌月払いに変わった
      month('2027-02', [L('基本給', 'base', 210000), L('残業手当', 'variable', 25000)]), // 単価の変更は固定的賃金ではない
      month('2027-03', [L('基本給', 'base', 210000), L('残業手当', 'variable', 22000)]),
    ]);
    expect(starts(p)).toEqual(['2027-01']);
  });

  it('26：給与計算期間の途中で昇給した月（日割りの月）は、1か月分がそろう次の月から数える', () => {
    const p = new Map([pay('2026-11', 200000), pay('2026-12', 202000, { prorated: true }), pay('2027-01', 240000), pay('2027-02', 240000)]);
    expect(starts(p)).toEqual(['2027-01']);
  });

  it('27：同じ月に増額と減額が重なったら、合計で向きを決める（基本給 −3,000円・家族手当 ＋5,000円 → 増額）', () => {
    const p = new Map([
      month('2026-03', [L('基本給', 'base', 250000), L('家族手当', 'fixedAllowance', 10000)]),
      month('2026-04', [L('基本給', 'base', 247000), L('家族手当', 'fixedAllowance', 15000)]),
    ]);
    expect(findStartMonths(p).map((s) => [s.month, s.direction])).toEqual([['2026-04', 'up']]);
  });

  it('31：増額と減額が打ち消し合って固定的賃金の合計が変わらなければ、起算月にしない', () => {
    const p = new Map([
      month('2026-03', [L('基本給', 'base', 250000), L('家族手当', 'fixedAllowance', 10000), L('残業手当', 'variable', 10000)]),
      month('2026-04', [L('基本給', 'base', 247000), L('家族手当', 'fixedAllowance', 13000), L('残業手当', 'variable', 60000)]),
    ]);
    expect(starts(p)).toEqual([]);
  });

  it('19：産休の間の控除（休暇に対して定めた給与）は固定的賃金の変動ではない。休業にかかる月は起算月にしない', () => {
    const p = new Map([
      pay('2026-07', 135500),
      pay('2026-08', 122100), // 産休の控除 13,400円
      pay('2026-09', 114730),
      pay('2026-10', 115400),
      pay('2026-11', 135500),
    ]);
    const leave = (m: string) => m >= '2026-08' && m <= '2026-10';
    expect(starts(p, { leaveAt: leave })).toEqual([]);
  });

  it('21：時給の人の、契約の1日の労働時間の変更（8時間 → 7.5時間。単価は同じ）は起算月になる', () => {
    const s = contractStartMonths(
      [
        { from: '2026-04-01', payType: 'hourly', hourlyWage: 1200, dailyWage: null, weeklyMinutes: 40 * 60 },
        { from: '2026-10-01', payType: 'hourly', hourlyWage: 1200, dailyWage: null, weeklyMinutes: 37.5 * 60 },
      ],
      (m) => `${m}-01`,
    );
    expect(s.map((x) => [x.month, x.direction])).toEqual([['2026-10', 'down']]);
  });
});

describe('疑義照会回答（算定基礎届・育児休業等終了時報酬月額変更届）：今のアプリで合っている件', () => {
  it('算定4：4〜6月とも休職で報酬を受けない人は、従前の報酬月額のまま。年4回以上の賞与に係る報酬は足さない', () => {
    const r = decideRegular({
      year: 2026,
      employee: { id: 'e', hireDate: '2020-04-01', retireDate: null, health: { enrolled: true, acquiredDate: '2020-04-01', lostDate: null }, pension: { enrolled: true, acquiredDate: '2020-04-01', lostDate: null } },
      payrolls: new Map([pay('2026-04', 0, { days: 0, state: 'suspended' }), pay('2026-05', 0, { days: 0, state: 'suspended' }), pay('2026-06', 0, { days: 0, state: 'suspended' })]),
      remunerations: [rem('2025-09', 300)],
      grades: GRADES,
      schedule: { closingDay: 31, payDay: 25, payMonth: 'next' },
      bonusMonthly: 50000,
    });
    expect(r.status).toBe('keep');
    expect(r.next?.health.standard).toBe(300000);
  });

  it('育休終了2：一時帰休が続いていても、育児休業等終了時改定はできる', () => {
    const leave: LeaveEndLeave = { kind: 'childcare', start: '2025-01-27', plannedEnd: '2025-11-30', end: null, birthDate: null, childBirthDate: '2024-12-01' };
    const r = judgeLeaveEnd({
      leave,
      allLeaves: [leave],
      payrolls: new Map([pay('2025-12', 200000, { state: 'furlough' }), pay('2026-01', 200000, { days: 30 }), pay('2026-02', 200000, { state: 'furlough', days: 28 })]),
      remunerations: [rem('2025-09', 260)],
      gradesAt: () => GRADES,
      minDaysAt: () => 17,
      partAt: () => false,
      pensionAt: () => true,
    })!;
    expect(r.startMonth).toBe('2025-12');
    expect(r.status).toBe('candidate');
  });
});

describe('疑義照会回答：照らし合わせて直したもの（11/26）', () => {
  // 一時帰休：4〜7月払い（4か月）。8月払いで解消
  const furlough = (over: [string, Payroll][] = []) =>
    new Map([
      pay('2026-03', 300000),
      pay('2026-04', 240000, { state: 'furlough' }),
      pay('2026-05', 240000, { state: 'furlough' }),
      pay('2026-06', 240000, { state: 'furlough' }),
      pay('2026-07', 240000, { state: 'furlough' }),
      pay('2026-08', 300000),
      ...over,
    ]);

  it('月変25：休業手当で改定していなければ、解消して報酬が上がっても随時改定にしない', () => {
    expect(furloughEndAllowed('2026-08', furlough(), [rem('2025-09', 300)])).toBeFalse();
  });

  it('月変25：一時帰休が始まった月を起算月とした改定（7月から）があれば、解消を随時改定の候補にする', () => {
    expect(furloughEndAllowed('2026-08', furlough(), [rem('2025-09', 300), { ...rem('2026-07', 240), reason: 'irregular' }])).toBeTrue();
  });

  it('月変25：休業手当の月を含めて定時決定した（7/1までに解消していなかった）なら、解消は候補', () => {
    expect(furloughEndAllowed('2026-08', furlough(), [rem('2025-09', 300), { ...rem('2026-09', 240), reason: 'regular' }])).toBeFalse(); // 解消より後の決定は数えない
    const longer = new Map([...furlough(), pay('2026-08', 240000, { state: 'furlough' }), pay('2026-09', 300000)]);
    expect(furloughEndAllowed('2026-09', longer, [rem('2025-09', 300), { ...rem('2026-09', 240), reason: 'regular' }])).toBeTrue();
  });

  it('月変28の②：一時帰休の間に昇給していれば、戻った月をその昇給の起算月にする（解消の候補ではない）', () => {
    const raised = new Map([...furlough(), pay('2026-08', 320000)]);
    expect(findStartMonths(raised).find((s) => s.month === '2026-08')).toEqual({ month: '2026-08', direction: 'up', source: 'fixed' });
    expect(findStartMonths(furlough()).find((s) => s.month === '2026-08')?.source).toBe('furlough');
  });

  it('月変14：7/5払いに6月分の休業手当が入っていても、7/1から一時帰休をしていなければ解消（月末締め・翌月5日払い）', () => {
    const schedule = { closingDay: 31, payDay: 5, payMonth: 'next' as const };
    // 1〜6月の期間が一時帰休 → 2〜7月払いが一時帰休。8月払い（7月の期間）はふつう
    const payrolls = new Map([
      pay('2026-03', 300000, { state: 'furlough' }),
      pay('2026-04', 250000, { state: 'furlough' }),
      pay('2026-05', 250000, { state: 'furlough', days: 30 }),
      pay('2026-06', 250000, { state: 'furlough' }),
      pay('2026-07', 250000, { state: 'furlough', days: 30 }),
      pay('2026-08', 300000),
    ]);
    expect(july1PayOf(payrolls, schedule, 2026)?.paidMonth).toBe('2026-08');
    const input = {
      year: 2026,
      employee: { id: 'e', hireDate: '2020-04-01', retireDate: null, health: { enrolled: true, acquiredDate: '2020-04-01', lostDate: null }, pension: { enrolled: true, acquiredDate: '2020-04-01', lostDate: null } },
      payrolls,
      remunerations: [rem('2025-09', 300)],
      grades: GRADES,
      schedule,
    };
    // 解消：休業手当の月を除く → 4〜6月とも除かれ、休業手当で決める前の標準報酬（30万円）のまま
    const r = decideRegular(input);
    expect(r.months.every((m) => m.skip === 'furloughResolved')).toBeTrue();
    // 8月払いがまだ入っていなければ、7月払いで見る（解消していない：休業手当を含めて平均）
    payrolls.delete('2026-08');
    expect(decideRegular({ ...input, payrolls }).average).toBe(250000);
  });

  it('育休終了1：日給で所定労働日数が通常より少ない短時間正社員も、パートと同じ15日の扱い', () => {
    const ctx = {
      office: { standardHours: { weeklyMinutes: 2400, monthlyDays: 20 }, specificApplication: { since: null } },
      criteria: [{ from: '2024-10', weeklyMinutesMin: 1200, wageMin: 88000, reducedWageMin: null }],
      schedule: { closingDay: 31, payDay: 25, payMonth: 'next' as const },
    };
    const person = (payType: 'daily' | 'monthly', monthlyDays: number) => ({
      employee: { id: 'e', birthDate: '1990-01-01', optInDate: null, optOutDate: null } as never,
      contracts: [
        { from: '2026-04-01', employmentType: 'regular', payType, weeklyMinutes: 1920, monthlyDays, scheduledWage: 200000, periodEnd: null, renewal: 'none', student: 'none', minimumWageReduction: false },
      ] as never,
    });
    expect(dayRulesOf(person('daily', 16), ctx).partAt('2026-06')).toBeTrue();
    expect(dayRulesOf(person('daily', 20), ctx).partAt('2026-06')).toBeFalse(); // 所定日数が同じ
    expect(dayRulesOf(person('monthly', 16), ctx).partAt('2026-06')).toBeFalse(); // 月給
  });
});

describe('疑義照会回答：遡及支払額のいつの分か・締め日の変更で増えた分（11/26）', () => {
  // 月変13：4月に5万円昇給、6月に4月にさかのぼる5万円の昇給（4・5月分の差額10万円を6月に払った）
  const case13 = (retroFrom: string | null) =>
    new Map([
      month('2026-03', [L('基本給', 'base', 150000)]),
      month('2026-04', [L('基本給', 'base', 200000)]),
      month('2026-05', [L('基本給', 'base', 200000)]),
      month('2026-06', [L('基本給', 'base', 250000), L('昇給差額', 'retro', 100000, retroFrom ? { retroFrom } : {})]),
      month('2026-07', [L('基本給', 'base', 250000)]),
      month('2026-08', [L('基本給', 'base', 250000)]),
    ]);
  const judge = (p: Map<string, Payroll>, startMonth: string) =>
    judgeIrregular({
      start: findStartMonths(p).find((s) => s.month === startMonth)!,
      payrolls: p,
      remunerations: [rem('2025-09', 150)],
      gradesAt: () => GRADES,
      minDaysAt: () => 17,
      pensionAt: () => true,
    });

  it('月変13：4月起算は、6月の差額（4・5月分）を除かず 20万・20万・35万で平均する（25万円）', () => {
    const p = case13('2026-04');
    expect(findStartMonths(p).map((s) => s.month)).toEqual(['2026-04', '2026-06']);
    const r = judge(p, '2026-04');
    expect(r.average!.total).toBe(750000);
    expect(r.average!.corrected).toBe(250000);
  });

  it('月変13：6月起算は、起算月より前の4・5月分の差額を除いて平均する（保険者算定。25万円）', () => {
    const r = judge(case13('2026-04'), '2026-06');
    expect(r.average!.total).toBe(850000);
    expect(r.average!.corrected).toBe(250000);
  });

  it('いつの分か分からない遡及支払額は、今までどおり全部除く', () => {
    expect(judge(case13(null), '2026-04').average!.corrected).toBe(216666);
  });

  it('算定1：締め日の変更で6月に増えた期間（6/1〜15）の給与は、平均から除いて修正平均を出す。固定的賃金の変動にもしない', () => {
    const p = new Map([
      month('2026-03', [L('基本給', 'base', 200000)], { days: 31 }),
      month('2026-04', [L('基本給', 'base', 200000)], { days: 31 }),
      month('2026-05', [L('基本給', 'base', 200000)], { days: 30 }),
      month('2026-06', [L('基本給', 'base', 200000), L('基本給（6/1〜15）', 'base', 100000, { periodChange: true })], { days: 31 }),
    ]);
    expect(p.get('2026-06')!.cash).toBe(300000); // 払った額はそのまま
    expect(findStartMonths(p)).toEqual([]);
    const r = decideRegular({
      year: 2026,
      employee: { id: 'e', hireDate: '2020-04-01', retireDate: null, health: { enrolled: true, acquiredDate: '2020-04-01', lostDate: null }, pension: { enrolled: true, acquiredDate: '2020-04-01', lostDate: null } },
      payrolls: p,
      remunerations: [rem('2025-09', 200)],
      grades: GRADES,
      schedule: { closingDay: 31, payDay: 20, payMonth: 'next' },
    });
    expect(r.rawAverage).toBe(233333);
    expect(r.average).toBe(200000);
    expect(r.hasRetro).toBeTrue(); // 届には修正平均額を書く
  });
});
