import { emptyPayrollInput, Payroll } from '../../../core/models/payroll';
import type { WageChange } from '../../../core/models/revision';
import { GRADES, healthGradeOf, pensionGradeOf } from './grades.fixture';
import { findStartMonths, IrregularInput, judgeIrregular, StartMonth } from './irregular';
import type { Remuneration } from './regular';

function pay(month: string, cash: number, fixed: number, days = 31, retro = 0): [string, Payroll] {
  return [
    month,
    { ...emptyPayrollInput(), officeId: 'o', employeeId: 'e', paidMonth: month, cash, fixed, days, retro },
  ];
}

/** 従前の標準報酬（千円。健保・厚年が同じ額のとき） */
function rem(from: string, k: number, monthlyAmount = k * 1000, pensionK = k): Remuneration {
  return {
    from,
    reason: 'regular',
    monthlyAmount,
    health: { grade: healthGradeOf(k), standard: k * 1000 },
    pension: { grade: pensionGradeOf(pensionK), standard: pensionK * 1000 },
  };
}

function input(
  start: StartMonth,
  payrolls: [string, Payroll][],
  remunerations: Remuneration[],
  p: Partial<IrregularInput> = {},
): IrregularInput {
  return {
    start,
    payrolls: new Map(payrolls),
    remunerations,
    gradesAt: () => GRADES,
    minDaysAt: () => 17,
    pensionAt: () => true,
    ...p,
  };
}

const up = (month: string): StartMonth => ({ month, direction: 'up', source: 'fixed' });

describe('findStartMonths：起算月の候補', () => {
  it('固定的賃金が前の月から変わった月。向きも出す', () => {
    const m = new Map([pay('2026-03', 215600, 205000), pay('2026-04', 258600, 235000), pay('2026-05', 230000, 200000)]);
    expect(findStartMonths(m)).toEqual([
      { month: '2026-04', direction: 'up', source: 'fixed' },
      { month: '2026-05', direction: 'down', source: 'fixed' },
    ]);
  });
  it('残業代だけ変わった月は候補にしない（非固定的賃金だけの変動）', () => {
    const m = new Map([pay('2026-03', 215600, 205000), pay('2026-04', 260000, 205000)]);
    expect(findStartMonths(m)).toEqual([]);
  });
  it('遡及支払がある月も候補（差額を払った月が起算月）', () => {
    const m = new Map([pay('2026-04', 210600, 200000), pay('2026-05', 283600, 200000, 30, 30000)]);
    expect(findStartMonths(m)).toEqual([{ month: '2026-05', direction: 'up', source: 'retro' }]);
  });
  it('休業で0円の月は飛ばして、最後に払った月と比べる（育休明けの時短は「下がった」）', () => {
    const m = new Map([
      pay('2025-06', 270000, 270000),
      pay('2025-07', 0, 0, 0),
      pay('2026-08', 0, 0, 0),
      pay('2026-09', 200000, 190000),
      pay('2026-10', 200000, 190000),
    ]);
    expect(findStartMonths(m)).toEqual([{ month: '2026-09', direction: 'down', source: 'fixed' }]);
  });
  it('実績の初めの月（比べる相手がない）は候補にしない', () => {
    expect(findStartMonths(new Map([pay('2026-04', 200000, 200000)]))).toEqual([]);
  });
  it('人が足した月・外した月（wageChanges）', () => {
    const m = new Map([pay('2026-03', 215600, 205000), pay('2026-04', 258600, 235000)]);
    const changes = [
      { month: '2026-04', source: 'dismissed', kind: 'other', direction: 'up', note: null },
      { month: '2026-06', source: 'manual', kind: 'unitPrice', direction: 'down', note: null },
    ] as WageChange[];
    expect(findStartMonths(m, changes)).toEqual([{ month: '2026-06', direction: 'down', source: 'manual' }]);
  });
});

describe('judgeIrregular：ガイドブック26ページの記入例', () => {
  // 従前 220千円（健保18級・厚年15級）。基本給 200,000 → 230,000。末締め翌月15日払い
  it('昇給したとき：4月起算、7月改定、平均 257,100円 → 260千円（2等級上がる）', () => {
    const r = judgeIrregular(
      input(
        up('2026-04'),
        [pay('2026-04', 258600, 235000, 31), pay('2026-05', 257300, 235000, 30), pay('2026-06', 255400, 235000, 31)],
        [rem('2025-09', 220)],
      ),
    );
    expect(r.status).toBe('candidate');
    expect(r.revisedFrom).toBe('2026-07');
    expect(r.average).toEqual({ total: 771300, retro: 0, average: 257100, corrected: 257100 });
    expect(r.health?.after.standard).toBe(260000);
    expect(r.health?.diff).toBe(2);
    expect(r.pension?.after.standard).toBe(260000);
    expect(r.pension?.revise).toBeTrue();
  });
  it('昇給差額が支給されたとき：5月起算、8月改定、修正平均 255,433円', () => {
    const r = judgeIrregular(
      input(
        up('2026-05'),
        [pay('2026-05', 283600, 230000, 30, 30000), pay('2026-06', 257300, 230000, 31), pay('2026-07', 255400, 230000, 30)],
        [rem('2025-09', 220)],
      ),
    );
    expect(r.revisedFrom).toBe('2026-08');
    expect(r.average).toEqual({ total: 796300, retro: 30000, average: 265433, corrected: 255433 });
    expect(r.health?.after.standard).toBe(260000);
    expect(r.status).toBe('candidate');
  });
});

describe('judgeIrregular：当たらない場合', () => {
  const rows: [string, Payroll][] = [pay('2026-04', 258600, 235000), pay('2026-05', 257300, 235000), pay('2026-06', 255400, 235000)];
  it('3か月の実績がそろっていなければ waiting', () => {
    expect(judgeIrregular(input(up('2026-04'), rows.slice(0, 2), [rem('2025-09', 220)])).status).toBe('waiting');
  });
  it('17日未満の月が1つでもあれば shortDays。短時間労働者の月は11日', () => {
    const short: [string, Payroll][] = [rows[0], pay('2026-05', 257300, 235000, 16), rows[2]];
    expect(judgeIrregular(input(up('2026-04'), short, [rem('2025-09', 220)])).status).toBe('shortDays');
    const st = judgeIrregular(input(up('2026-04'), short, [rem('2025-09', 220)], { minDaysAt: () => 11 }));
    expect(st.status).toBe('candidate');
  });
  it('1等級差なら noGradeDiff', () => {
    expect(judgeIrregular(input(up('2026-04'), rows, [rem('2025-09', 240)])).status).toBe('noGradeDiff');
  });
  it('固定的賃金は上がったが、残業代が減って平均が2等級下がった → 改定しない（opposite）', () => {
    const r = judgeIrregular(input(up('2026-04'), rows, [rem('2025-09', 300)]));
    expect(r.health?.diff).toBe(-2);
    expect(r.status).toBe('opposite');
  });
});

describe('judgeIrregular：上限・下限の特例と、健保・厚年を別々に判定', () => {
  it('厚年31級 620千円 → 平均 665千円以上で32級（1等級差でも改定）', () => {
    const rows: [string, Payroll][] = [pay('2026-04', 670000, 600000), pay('2026-05', 670000, 600000), pay('2026-06', 670000, 600000)];
    const r = judgeIrregular(input(up('2026-04'), rows, [rem('2025-09', 620)]));
    expect(r.pension?.diff).toBe(1);
    expect(r.pension?.special).toBeTrue();
    expect(r.pension?.revise).toBeTrue();
  });
  it('平均 660千円なら厚年は特例に当たらない（健保は 620 → 650 の1等級差で改定しない）', () => {
    const rows: [string, Payroll][] = [pay('2026-04', 660000, 600000), pay('2026-05', 660000, 600000), pay('2026-06', 660000, 600000)];
    const r = judgeIrregular(input(up('2026-04'), rows, [rem('2025-09', 620)]));
    expect(r.pension?.special).toBeFalse();
    expect(r.status).toBe('noGradeDiff');
  });
  it('健保だけ2等級差（厚年は上限のまま）→ 健保だけ改定', () => {
    // 従前：健保 650千（35級）・厚年 650千（32級＝上限）、報酬月額 640千
    const rows: [string, Payroll][] = [pay('2026-04', 720000, 700000), pay('2026-05', 720000, 700000), pay('2026-06', 720000, 700000)];
    const r = judgeIrregular(input(up('2026-04'), rows, [rem('2025-09', 650, 640000)]));
    expect(r.health?.after.standard).toBe(710000);
    expect(r.health?.revise).toBeTrue();
    expect(r.pension?.diff).toBe(0);
    expect(r.pension?.revise).toBeFalse();
    expect(r.status).toBe('candidate');
  });
  it('改定月に厚年の資格がない（70歳以上など）なら健保だけ判定', () => {
    const rows: [string, Payroll][] = [pay('2026-04', 258600, 235000), pay('2026-05', 257300, 235000), pay('2026-06', 255400, 235000)];
    const r = judgeIrregular(input(up('2026-04'), rows, [rem('2025-09', 220)], { pensionAt: () => false }));
    expect(r.pension).toBeNull();
    expect(r.status).toBe('candidate');
  });
});
