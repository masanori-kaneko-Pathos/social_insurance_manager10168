/**
 * 日本年金機構「調査指摘・改善指導事例集」（年金制度説明会 2026 宮城）の事例を、そのままの数字で確かめる（11/19）
 * 期待値は資料の「○」の標準報酬月額の変遷。支払基礎日数は月給者なので暦日（31日）にしている
 *
 * 固定的賃金：基本給・定額の手当（A〜C 手当・管理職手当・住宅手当・単身赴任手当）・定額の通勤手当
 * 非固定的賃金：時間外手当・交替勤務手当・出勤日数で変わる自動車通勤手当
 */
import { emptyPayrollInput, Payroll } from '../../../core/models/payroll';
import type { WageChange } from '../../../core/models/revision';
import { GRADES, healthGradeOf, pensionGradeOf } from './grades.fixture';
import { findStartMonths, judgeIrregular, StartMonth } from './irregular';
import type { Remuneration } from './regular';

function pay(month: string, cash: number, fixed: number, x: Partial<Payroll> = {}): [string, Payroll] {
  return [month, { ...emptyPayrollInput(), officeId: 'o', employeeId: 'e', paidMonth: month, cash, fixed, days: 31, ...x }];
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
const manual = (month: string, direction: 'up' | 'down' | 'unclear', kind: WageChange['kind']): WageChange =>
  ({ employeeId: 'e', month, kind, direction, source: 'manual', note: '' }) as unknown as WageChange;

/** 起算月の候補ごとに判定して、改定するものだけ「改定月：標準報酬（千円）」で返す */
function revisions(payrolls: [string, Payroll][], current: Remuneration, changes: WageChange[] = []): string[] {
  const map = new Map(payrolls);
  return findStartMonths(map, changes)
    .map((start: StartMonth) =>
      judgeIrregular({ start, payrolls: map, remunerations: [current], gradesAt: () => GRADES, minDaysAt: () => 17, pensionAt: () => true }),
    )
    .filter((r) => r.status === 'candidate')
    .map((r) => `${r.revisedFrom}:${r.health!.after!.standard / 1000}`);
}

describe('事例3：非固定的賃金（交替勤務手当）の新設', () => {
  const fixed = 277400 + 5000 + 20000 + 10000;
  const pays = [
    pay('2024-08', 327010, fixed), pay('2024-09', 357856, fixed), pay('2024-10', 352272, fixed),
    pay('2024-11', 349016, fixed), pay('2024-12', 345519, fixed), pay('2025-01', 356083, fixed),
  ];
  it('固定的賃金の額は変わらないので、自動では見つからない（新設を人が足す）', () => {
    expect(revisions(pays, rem('2024-09', 320))).toEqual([]);
  });
  it('9月に「手当の新設」を足す → 12月に360千円（○）', () => {
    expect(revisions(pays, rem('2024-09', 320), [manual('2024-09', 'up', 'allowanceNew')])).toEqual(['2024-12:360']);
  });
});

describe('事例4：非固定的賃金（自動車通勤手当）の単価の変更', () => {
  const pays = [
    pay('2024-08', 221110, 195000), pay('2024-09', 243656, 195000), pay('2024-10', 256116, 215000),
    pay('2024-11', 271472, 215000), pay('2024-12', 275819, 215000),
  ];
  it('9月に「単価の変更」を足す → 12月に260千円（○）', () => {
    const r = revisions(pays, rem('2024-09', 220), [manual('2024-09', 'up', 'unitPrice')]);
    expect(r[0]).toBe('2024-12:260');
  });
});

describe('事例5：手当のさかのぼり支給（単身赴任手当を8・9月分から、10月にまとめて払った）', () => {
  const base = 220000 + 4060 + 20000 + 15000;
  it('本来の月（8・9月）の実績に入れ直す → 8月が起算月、11月に320千円（○）', () => {
    const pays = [
      pay('2024-07', 271171, base), pay('2024-08', 310096 + 10000, base + 10000), pay('2024-09', 320308 + 10000, base + 10000),
      pay('2024-10', 343556 - 20000, base + 10000), pay('2024-11', 301064, base + 10000), pay('2024-12', 338571, base + 10000),
    ];
    expect(revisions(pays, rem('2024-09', 280))).toEqual(['2024-11:320']);
  });
});

describe('事例6：同じ月に、固定的賃金が上がり（管理職手当の新設）、時間外手当がなくなった', () => {
  const before = 330000 + 4060 + 20000 + 10000;
  const after = 345000 + 4060 + 20000 + 10000 + 40000;
  const pays = [
    pay('2025-04', 468196, before), pay('2025-05', 462516, before), pay('2025-06', 437181, before),
    pay('2025-07', 419060, after), pay('2025-08', 419060, after), pay('2025-09', 419060, after),
  ];
  it('平均が下がっても改定する → 10月に410千円（○。増減の関連がはっきりしないので、上がっても下がっても対象）', () => {
    expect(revisions(pays, rem('2025-09', 470))).toEqual(['2025-10:410']);
  });
});

describe('事例7：固定的賃金（住宅手当）の新設月が日割り', () => {
  const pays = [
    pay('2024-12', 275247, 250000 + 10000 + 5700),
    pay('2025-01', 343410, 250000 + 28000 + 10000 + 1710, { prorated: true }),
    pay('2025-02', 347439, 250000 + 40000 + 10000), pay('2025-03', 346804, 250000 + 40000 + 10000),
    pay('2025-04', 343939, 250000 + 40000 + 10000),
  ];
  it('日割りの月（1月）は起算月にしない → 2月が起算月、5月に340千円（○）。4月の改定（×）は出さない', () => {
    expect(revisions(pays, rem('2024-09', 280))).toEqual(['2025-05:340']);
  });
});

describe('一時帰休（事例集 5(2)：随時改定）', () => {
  const normal = (m: string) => pay(m, 300000, 300000);
  const fur = (m: string) => pay(m, 180000, 300000, { state: 'furlough' });
  it('2月から一時帰休、5月の初めも続いている → 2〜4月の平均で、5月から改定（事例集 問2の例）', () => {
    const pays = [normal('2026-01'), fur('2026-02'), fur('2026-03'), fur('2026-04'), fur('2026-05'), fur('2026-06')];
    expect(revisions(pays, rem('2025-09', 300))).toEqual(['2026-05:180']);
  });
  it('4か月目の前に解消したら、始まりでは改定しない（3か月を超えない）', () => {
    const pays = [normal('2026-01'), fur('2026-02'), fur('2026-03'), fur('2026-04'), normal('2026-05'), normal('2026-06'), normal('2026-07')];
    expect(revisions(pays, rem('2025-09', 300))).toEqual([]);
  });
  it('解消して通常の報酬に戻った月から3か月で、もう一度改定（問5）。一時帰休の間の昇給も、戻った月から数える（問6）', () => {
    const pays = [
      normal('2026-01'), fur('2026-02'), fur('2026-03'), fur('2026-04'), fur('2026-05'),
      pay('2026-06', 330000, 330000), pay('2026-07', 330000, 330000), pay('2026-08', 330000, 330000),
    ];
    expect(revisions(pays, rem('2026-05', 180))).toEqual(['2026-09:340']); // 330,000円は 330,000〜350,000円の 340千円
  });
});

describe('休職（事例集 4 問8）', () => {
  it('休職中に昇給 → 休職中の月ではなく、戻った月を起算月にする', () => {
    const pays = [
      pay('2026-01', 300000, 300000),
      pay('2026-02', 100000, 330000, { state: 'suspended' }),
      pay('2026-03', 100000, 330000, { state: 'suspended' }),
      pay('2026-04', 360000, 360000), pay('2026-05', 360000, 360000), pay('2026-06', 360000, 360000),
    ];
    expect(revisions(pays, rem('2025-09', 300))).toEqual(['2026-07:360']);
  });
});
