/**
 * 給与明細の行から始めて、正しい標準報酬月額になるかを確かめる（11/25）
 * 出典：日本年金機構「調査指摘・改善指導事例集（令和7年10月改訂）」
 *   https://www.nenkin.go.jp/service/riyoushabetsu/nenkiniin/kenshu/1.files/kounen2026_02.pdf
 *
 * audit-cases.spec.ts（11/19）は総支給額・固定的賃金を手で足した値から始めていた。
 * ここでは明細の「項目名と金額」をそのまま入れ、アプリの分類（categoryOf）→ 内訳の読み取り（readEntry）
 * → 起算月の判定・定時決定 の順に、画面で入力したときと同じ道を通す。
 * 「計算に入る数字が正しいか」を、外の正解（資料の ○）で確かめるため
 *
 * 各月の行は、資料の表の列（総支給額・保険料・社宅使用料などの控除を除く）を左から写したもの。
 * 行の合計が資料の総支給額と一致することも確かめる（写し間違いの検出）
 */
import { emptyPayrollInput, Payroll } from '../../../core/models/payroll';
import type { PayrollItemInput } from '../../../core/models/payroll-item';
import type { WageChange } from '../../../core/models/revision';
import { GRADES, healthGradeOf, pensionGradeOf } from './grades.fixture';
import { housingValue, inKindAmount } from './in-kind';
import { findStartMonths, judgeIrregular } from './irregular';
import { readEntry, textOf } from './payroll-input';
import { allocateOtherMonths, categoryOf } from './payroll-lines';
import { decideRegular, over70Basis, regularFormAmounts, Remuneration } from './regular';
import { standardBonusOf } from '../../premiums/logic/calc-bonus';
import { resolveItems } from '../../premiums/logic/bonus-items';
import { bonusRemunerationOf, isRemunerationBonus, NaturePaymentLike } from '../../premiums/logic/bonus-nature';
import type { PayrollEmployee, PaySchedule } from './payroll-rows';

/**
 * 事業所の「給与の項目と分類」に、労務担当が登録する項目（アプリのよくある名前にないもの）
 * 資料の説明どおりに分類する：A〜C手当・単身赴任手当・新生活補助は定額の手当、交替勤務手当・在宅勤務手当は回数で変わる手当
 */
const OFFICE_ITEMS: PayrollItemInput[] = [
  { name: 'A手当', labels: [], category: 'fixedAllowance' },
  { name: 'B手当', labels: [], category: 'fixedAllowance' },
  { name: 'C手当', labels: [], category: 'fixedAllowance' },
  { name: '単身赴任手当', labels: [], category: 'fixedAllowance' },
  { name: '新生活補助', labels: [], category: 'fixedAllowance' },
  { name: '交替勤務手当', labels: [], category: 'variable' },
  { name: '在宅勤務手当', labels: [], category: 'variable' },
];

type Line = [name: string, amount: number, forMonth?: string];

/** 明細の行 → 給与の実績（画面の「内訳」で入れたときと同じ読み方） */
function slip(
  month: string,
  lines: Line[],
  x: { gross?: number; prorated?: boolean; inKind?: number; days?: number } = {},
  items: readonly PayrollItemInput[] = OFFICE_ITEMS,
): [string, Payroll] {
  const drafts = lines.map(([name, amount, forMonth]) => ({
    name,
    category: categoryOf(name, items),
    amount: String(amount),
    forMonth: forMonth ?? null,
  }));
  const text = { ...textOf(null), days: String(x.days ?? 31), inKind: x.inKind ? String(x.inKind) : '', prorated: !!x.prorated };
  const r = readEntry(text, drafts, 'monthly', 31);
  if (r.kind !== 'ok') throw new Error(`${month} が読めない：${JSON.stringify(r)}`);
  // 写し間違いの検出：行の合計（精算の行も含む）が資料の総支給額と同じ
  if (x.gross !== undefined && r.input.cash !== x.gross) throw new Error(`${month} の合計 ${r.input.cash} が資料の総支給額 ${x.gross} と違う`);
  return [month, { ...emptyPayrollInput(), ...r.input, officeId: 'o', employeeId: 'e', paidMonth: month }];
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

/** 随時改定：本来の月への割り振り → 起算月 → 判定。改定するものを「改定月:標準報酬（千円）」で返す */
function revisions(pays: [string, Payroll][], current: Remuneration, changes: WageChange[] = []): string[] {
  const map = allocateOtherMonths(new Map(pays)).payrolls;
  return findStartMonths(map, changes)
    .map((start) => judgeIrregular({ start, payrolls: map, remunerations: [current], gradesAt: () => GRADES, minDaysAt: () => 17, pensionAt: () => true }))
    .filter((r) => r.status === 'candidate')
    .map((r) => `${r.revisedFrom}:${r.health!.after!.standard / 1000}`);
}

/** 起算月の候補（月:向き:見つけ方） */
function starts(pays: [string, Payroll][], changes: WageChange[] = []): string[] {
  return findStartMonths(allocateOtherMonths(new Map(pays)).payrolls, changes).map((s) => `${s.month}:${s.direction}:${s.source}`);
}

const NEXT_MONTH_PAY: PaySchedule = { closingDay: 31, payDay: 25, payMonth: 'current' };
function emp(acquiredDate: string): PayrollEmployee {
  return {
    id: 'e',
    hireDate: acquiredDate,
    retireDate: null,
    health: { enrolled: true, acquiredDate, lostDate: null },
    pension: { enrolled: true, acquiredDate, lostDate: null },
  };
}

// ============================================================================

describe('明細の行の分類（事例集の項目名）', () => {
  it('よくある名前は、登録しなくても分類が決まる', () => {
    expect(categoryOf('基本給', [])).toBe('base');
    expect(categoryOf('時間外手当', [])).toBe('variable');
    expect(categoryOf('通勤手当', [])).toBe('commute');
    expect(categoryOf('住宅手当', [])).toBe('fixedAllowance');
    expect(categoryOf('職務手当', [])).toBe('fixedAllowance');
    expect(categoryOf('管理職手当', [])).toBe('fixedAllowance');
  });
  it('会社ごとの名前（A手当・交替勤務手当など）は、登録するまで分類が決まらない（保存できない）', () => {
    for (const n of ['A手当', '交替勤務手当', '単身赴任手当', '新生活補助', '在宅勤務手当', '自動車通勤手当', '支度金']) {
      expect(categoryOf(n, [])).withContext(n).toBeNull();
    }
  });
  it('明細の控除欄（社宅使用料）は、欠勤控除の分類にならない', () => {
    expect(categoryOf('社宅使用料', [])).toBeNull();
  });
});

describe('事例2：資格取得時の報酬月額に、あとから申請された通勤手当・住宅手当を入れる', () => {
  // 資料の金額：基本給＋A手当＋B手当 ＝ 214,000円、通勤手当＋住宅手当 ＝ 22,000円（事例1の明細の額）
  it('明細の行で入れると 236,000円 → 240千円（○）。通勤・住宅を入れないと 214,000円 → 220千円（×）', () => {
    const [, ok] = slip('2025-05', [['基本給', 200000], ['A手当', 4000], ['B手当', 10000], ['通勤手当', 10000], ['住宅手当', 12000]]);
    const [, ng] = slip('2025-04', [['基本給', 200000], ['A手当', 4000], ['B手当', 10000]]);
    const std = (v: number) => GRADES.health.filter((g) => g.min <= v).at(-1)!.standard / 1000;
    expect(ok.fixed).toBe(236000);
    expect(std(ok.fixed)).toBe(240);
    expect(std(ng.fixed)).toBe(220);
  });
});

describe('事例3：交替勤務手当（非固定的賃金）の新設', () => {
  const fixed: Line[] = [['基本給', 277400], ['A手当', 5000], ['B手当', 20000], ['C手当', 10000]];
  const pays = [
    slip('2024-08', [...fixed, ['時間外手当', 14610]], { gross: 327010 }),
    slip('2024-09', [...fixed, ['交替勤務手当', 18600], ['時間外手当', 26856]], { gross: 357856 }),
    slip('2024-10', [...fixed, ['交替勤務手当', 15600], ['時間外手当', 24272]], { gross: 352272 }),
    slip('2024-11', [...fixed, ['交替勤務手当', 17400], ['時間外手当', 19216]], { gross: 349016 }),
    slip('2024-12', [...fixed, ['交替勤務手当', 14400], ['時間外手当', 18719]], { gross: 345519 }),
    slip('2025-01', [...fixed, ['交替勤務手当', 15600], ['時間外手当', 28083]], { gross: 356083 }),
  ];
  it('固定的賃金は 312,400円のまま（交替勤務手当は非固定）', () => {
    expect(pays.map(([, p]) => p.fixed)).toEqual([312400, 312400, 312400, 312400, 312400, 312400]);
  });
  it('9月に「手当の新設」を人が足す → 12月に360千円（○）', () => {
    expect(revisions(pays, rem('2024-09', 320), [manual('2024-09', 'up', 'allowanceNew')])).toEqual(['2024-12:360']);
  });
});

describe('事例4：自動車通勤手当（1kmあたりの単価×距離×出勤日数）の単価の変更', () => {
  // 資料は自動車通勤手当を非固定的賃金と書いている（出勤日数で額が動く）。事業所の項目でも非固定的な手当に分類する
  const items: PayrollItemInput[] = [...OFFICE_ITEMS.filter((i) => i.name !== '自動車通勤手当'), { name: '自動車通勤手当', labels: [], category: 'variable' }];
  const fx: Line[] = [['A手当', 5000], ['B手当', 20000], ['C手当', 10000]];
  const row = (m: string, car: number, base: number, ot: number, gross: number) =>
    slip(m, [['自動車通勤手当', car], ['基本給', base], ...fx, ['時間外手当', ot]], { gross }, items);
  const pays = [
    row('2024-08', 1500, 160000, 24610, 221110),
    row('2024-09', 1800, 160000, 46856, 243656),
    row('2024-10', 1900, 180000, 39216, 256116),
    row('2024-11', 2200, 180000, 54272, 271472),
    row('2024-12', 2100, 180000, 58719, 275819),
  ];
  const remList = [rem('2024-09', 220), rem('2024-12', 260)];
  it('額で見つかるのは基本給が上がった10月だけ（単価の変更は額では見えない）', () => {
    expect(starts(pays)).toEqual(['2024-10:up:fixed']);
  });
  it('9月に「単価の変更」を人が足す → 12月に260千円（○）。10月の昇給は、12月の改定のあとでは等級差なし', () => {
    const map = allocateOtherMonths(new Map(pays)).payrolls;
    const r = findStartMonths(map, [manual('2024-09', 'up', 'unitPrice')]).map((start) =>
      judgeIrregular({ start, payrolls: map, remunerations: remList, gradesAt: () => GRADES, minDaysAt: () => 17, pensionAt: () => true }),
    );
    expect(r.map((x) => `${x.start.month}:${x.status}`)).toEqual(['2024-09:candidate', '2024-10:noGradeDiff']);
    expect(r[0].revisedFrom).toBe('2024-12');
    expect(r[0].health!.after!.standard).toBe(260000);
  });
});

describe('通勤手当の2つの形（11/25 の整理）', () => {
  const m = (month: string, commute: [string, number], ot: number) => slip(month, [['基本給', 250000], commute, ['時間外手当', ot]]);
  it('定期代（分類：通勤手当）が運賃の改定で上がった → その月が起算月（額の変化で見つかる）', () => {
    const pays = [m('2025-03', ['通勤手当', 10000], 20000), m('2025-04', ['通勤手当', 10000], 15000), m('2025-05', ['通勤手当', 11000], 30000)];
    expect(starts(pays)).toEqual(['2025-05:up:fixed']);
  });
  it('1日いくら×出勤日数（分類：非固定的な手当）は、出勤日数で額が動いても起算月にならない', () => {
    const items: PayrollItemInput[] = [{ name: '交通費（日額）', labels: [], category: 'variable' }];
    const d = (month: string, days: number) => slip(month, [['基本給', 250000], ['交通費（日額）', 600 * days]], {}, items);
    expect(starts([d('2025-03', 20), d('2025-04', 18), d('2025-05', 22)])).toEqual([]);
  });
});

describe('事例5：単身赴任手当を8・9月分から、10月にまとめて払った', () => {
  const fx: Line[] = [['基本給', 220000], ['A手当', 4060], ['B手当', 20000], ['C手当', 15000]];
  const pays = [
    slip('2024-07', [...fx, ['時間外手当', 12111]], { gross: 271171 }),
    slip('2024-08', [...fx, ['時間外手当', 51036]], { gross: 310096 }),
    slip('2024-09', [...fx, ['時間外手当', 61248]], { gross: 320308 }),
    // 資料の「精算支給 20,000」は8月分・9月分の単身赴任手当。本来の月を付けて2行で入れる
    slip('2024-10', [...fx, ['単身赴任手当', 10000], ['時間外手当', 54496], ['単身赴任手当', 10000, '2024-08'], ['単身赴任手当', 10000, '2024-09']], { gross: 343556 }),
    slip('2024-11', [...fx, ['単身赴任手当', 10000], ['時間外手当', 32004]], { gross: 301064 }),
    slip('2024-12', [...fx, ['単身赴任手当', 10000], ['時間外手当', 69511]], { gross: 338571 }),
  ];
  it('8月が起算月、11月に320千円（○）。10月を起算月にした1月の改定（×）は出さない', () => {
    expect(revisions(pays, rem('2024-09', 280))).toEqual(['2024-11:320']);
  });
});

describe('事例6：管理職になり、基本給が上がって管理職手当が付き、時間外手当がなくなった', () => {
  const fx = (base: number): Line[] => [['基本給', base], ['A手当', 4060], ['B手当', 20000], ['C手当', 10000]];
  const pays = [
    slip('2025-04', [...fx(330000), ['時間外手当', 104136]], { gross: 468196 }),
    slip('2025-05', [...fx(330000), ['時間外手当', 98456]], { gross: 462516 }),
    slip('2025-06', [...fx(330000), ['時間外手当', 73121]], { gross: 437181 }),
    slip('2025-07', [...fx(345000), ['管理職手当', 40000]], { gross: 419060 }),
    slip('2025-08', [...fx(345000), ['管理職手当', 40000]], { gross: 419060 }),
    slip('2025-09', [...fx(345000), ['管理職手当', 40000]], { gross: 419060 }),
  ];
  it('平均が下がっても改定する → 10月に410千円（○）', () => {
    expect(revisions(pays, rem('2025-09', 470))).toEqual(['2025-10:410']);
  });
});

describe('事例7：異動で住宅手当が新設され、初回は日割り', () => {
  const pays = [
    slip('2024-12', [['通勤手当', 5700], ['基本給', 250000], ['A手当', 10000], ['時間外手当', 9547]], { gross: 275247 }),
    slip('2025-01', [['通勤手当', 1710], ['基本給', 250000], ['住宅手当', 28000], ['A手当', 10000], ['時間外手当', 53700]], { gross: 343410, prorated: true }),
    slip('2025-02', [['基本給', 250000], ['住宅手当', 40000], ['A手当', 10000], ['時間外手当', 47439]], { gross: 347439 }),
    slip('2025-03', [['基本給', 250000], ['住宅手当', 40000], ['A手当', 10000], ['時間外手当', 46804]], { gross: 346804 }),
    slip('2025-04', [['基本給', 250000], ['住宅手当', 40000], ['A手当', 10000], ['時間外手当', 43939]], { gross: 343939 }),
  ];
  it('起算月は2月だけ（1月は日割りなので次の月へ送る）', () => {
    expect(starts(pays)).toEqual(['2025-02:up:fixed']);
  });
  it('2月が起算月、5月に340千円（○）。4月の改定（×）は出さない', () => {
    expect(revisions(pays, rem('2024-09', 280))).toEqual(['2025-05:340']);
  });
});

describe('事例8：借り上げ社宅の現物給与（定時決定）', () => {
  // 神奈川県の住宅の価額 2,150円／畳（令和7年度）× 12畳 − 本人負担 5,000円 ＝ 20,800円
  const kanagawa = { housing: 2150, meal: { month: 0, breakfast: 0, lunch: 0, dinner: 0 } } as never;
  const housing = inKindAmount(kanagawa, { meal: null, housing: { size: 12, proration: null, employeePays: 5000 } });
  const row = (m: string, ot: number, gross: number, inKind: number) =>
    slip(m, [['通勤手当', 5950], ['基本給', 230000], ['職務手当', 5500], ['時間外手当', ot]], { gross, inKind });
  const decide = (inKind: number) =>
    decideRegular({
      year: 2025,
      employee: emp('2020-04-01'),
      payrolls: new Map([row('2025-04', 28990, 270440, inKind), row('2025-05', 49890, 291340, inKind), row('2025-06', 39580, 281030, inKind)]),
      remunerations: [rem('2024-09', 280)],
      grades: GRADES,
      schedule: NEXT_MONTH_PAY,
    });
  it('現物給与の額は 20,800円', () => {
    expect(housing.total).toBe(20800);
  });
  it('現物を入れる → 300千円（○）。入れないと 280千円（×）', () => {
    expect(decide(housing.total).next!.health.standard).toBe(300000);
    expect(decide(0).next!.health.standard).toBe(280000);
  });
});

describe('事例9：初回の給与の支度金（一時金）と、毎月の新生活補助', () => {
  const fx: Line[] = [['基本給', 190000], ['A手当', 20000], ['通勤手当', 25000]];
  // 4月入社で4月21日払い（当月払い）なので、4月は1か月分そろっていない月（15日締め・当月21日払いとした）
  const april = slip('2025-04', [...fx, ['新生活補助', 30000]], { gross: 365000 - 100000 });
  const pays = [
    april,
    slip('2025-05', [...fx, ['在宅勤務手当', 600], ['新生活補助', 30000], ['時間外手当', 38049]], { gross: 303649 }),
    slip('2025-06', [...fx, ['在宅勤務手当', 1500], ['新生活補助', 30000], ['時間外手当', 35122]], { gross: 301622 }),
  ];
  it('支度金 100,000円は賞与：標準賞与額 100千円（○）', () => {
    expect(standardBonusOf(100000)).toBe(100000);
  });
  it('新生活補助は毎月の報酬。定時決定 → 300千円（○）', () => {
    const r = decideRegular({
      year: 2025,
      employee: emp('2025-04-01'),
      payrolls: new Map(pays),
      remunerations: [rem('2025-04', 300)],
      grades: GRADES,
      schedule: { closingDay: 15, payDay: 21, payMonth: 'current' },
    });
    expect(r.months.map((m) => (m.used ? m.amount : m.skip))).toEqual(['partialAcquisition', 303649, 301622]);
    expect(r.next!.health.standard).toBe(300000);
  });
});

// ===== 賞与と賞与に係る報酬（事例10・11。原本 p.19・p.21 の表から。11/25） =====

/** 業績手当の支給（支払日は資料にないので、その月の20日とした） */
const perf = (month: string, amounts: Record<string, number>): NaturePaymentLike => ({
  id: month,
  paidDate: `${month}-20`,
  amounts,
  nature: '業績手当',
});

describe('事例10：業績手当（6・12・3月）の規程を、R7.7.1 から年4回に改訂した', () => {
  // 賞与の項目「業績手当」：2025年の定時決定から「年4回以上の賞与」、規程の回数 4
  const item = [{ name: '業績手当', labels: [], plannedCount: 4, treatments: [{ fromYear: 0, treatment: 'count' as const }, { fromYear: 2025, treatment: 'remuneration' as const }] }];
  const pays = resolveItems(
    [perf('2024-12', { e: 75000 }), perf('2025-03', { e: 75000 }), perf('2025-06', { e: 30000 }), perf('2025-07', { e: 60000 })],
    item,
    '賞与',
  );
  const fx: Line[] = [['基本給', 190000], ['通勤手当', 25000]];
  const months = new Map([
    slip('2025-04', [...fx, ['時間外手当', 37124]]),
    slip('2025-05', [...fx, ['時間外手当', 25665]]),
    slip('2025-06', [...fx, ['時間外手当', 9849]]),
  ]);
  const decide = (bonusMonthly: number) =>
    decideRegular({ year: 2025, employee: emp('2020-04-01'), payrolls: months, remunerations: [rem('2024-09', 240)], grades: GRADES, schedule: NEXT_MONTH_PAY, bonusMonthly });

  it('R6.12・R7.3・R7.6 の 75・75・30千円と、R7.7 の 60千円は賞与（R7.7 は賞与支払届を出す。○）', () => {
    expect(pays.map((p) => isRemunerationBonus('e', p, pays))).toEqual([false, false, false, false]);
    expect(pays.map((p) => standardBonusOf(p.amounts['e']) / 1000)).toEqual([75, 75, 30, 60]);
  });
  it('R7 の定時決定：賞与に係る報酬 ＝ 実績3回 180,000円 × 4回 ÷ 3回 ÷ 12 ＝ 20,000円（○ 2万円）', () => {
    expect(bonusRemunerationOf('e', 2025, pays, '2020-04-01').monthly).toBe(20000);
  });
  it('2万円を各月に足して 260千円（○）。足さないと 240千円のまま', () => {
    expect(decide(20000).next!.health.standard).toBe(260000);
    expect(decide(0).next!.health.standard).toBe(240000);
  });
});

describe('事例11：3か月ごとの業績手当（営業実績が届かない期は 0円）', () => {
  // 原本 p.21 の表。R6.4〜R6.5・R5 以前の支給は表にない
  const pays = [
    perf('2024-06', { B: 60000, C: 60000 }),
    perf('2024-09', { A: 60000 }),
    perf('2024-12', { A: 60000, B: 60000, C: 60000 }),
    perf('2025-03', { A: 60000, B: 60000 }),
    perf('2025-06', { A: 60000, B: 60000, C: 60000 }),
    perf('2025-09', { A: 60000, B: 60000 }),
  ];
  const r79 = pays.find((p) => p.id === '2025-09')!;
  it('R7.7.1 前の1年：A は4回 → R7.9 からの支給は「賞与に係る報酬」。B は3回・C は2回 → 「賞与」（○）', () => {
    expect(isRemunerationBonus('A', r79, pays)).toBeTrue();
    expect(isRemunerationBonus('B', r79, pays)).toBeFalse();
    expect(['A', 'B', 'C'].map((w) => bonusRemunerationOf(w, 2025, pays).annual)).toEqual([240000, 0, 0]);
  });
  it('A の R7 の定時決定に足す額：240,000円 ÷ 12 ＝ 20,000円（220 → 240千円の材料）', () => {
    expect(bonusRemunerationOf('A', 2025, pays).monthly).toBe(20000);
  });
  it('R6 の判定（R5.9・R5.12・R6.3 に全員へ払ったと仮定）：R6.6 に払った B・C は4回で反映、A は3回で反映しない（○）', () => {
    const withR5 = [perf('2023-09', { A: 60000, B: 60000, C: 60000 }), perf('2023-12', { A: 60000, B: 60000, C: 60000 }), perf('2024-03', { A: 60000, B: 60000, C: 60000 }), ...pays];
    expect(['A', 'B', 'C'].map((w) => bonusRemunerationOf(w, 2024, withR5).monthly)).toEqual([0, 20000, 20000]);
  });
});

describe('住宅の現物給与 Q7：月の途中（4/11）に入居（東京）', () => {
  const tokyo = (housing: number) => ({ housing, meal: { month: 0, day: 0, breakfast: 0, lunch: 0, dinner: 0 } }) as never;
  const april = { days: 20, daysInMonth: 30 };
  it('R8.9.30 まで：2,830円 × 居住室 16畳 × 20/30 ＝ 30,186円', () => {
    expect(housingValue(tokyo(2830), { size: 16, proration: april, employeePays: 0 })).toBe(30186);
  });
  it('R8.10.1 から：1,330円 × 総面積 40㎡ × 20/30 ＝ 35,466円', () => {
    expect(housingValue(tokyo(1330), { size: 40, proration: april, employeePays: 0 })).toBe(35466);
  });
});

// ===== 算定基礎届の記入・提出ガイドブック（令和8年度）の記入例（11/25） =====
// 出典 B：https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20121017.files/santei.guide.book.pdf
// 賃金台帳の行をそのまま明細の行として入れ、令和8年の定時決定にかける

const rowsOf = (lines: Line[], days: number, x: { inKind?: number } = {}) => ({ lines, days, ...x });
type Month = ReturnType<typeof rowsOf>;
function regular8(
  months: Record<'04' | '05' | '06', Month | null>,
  o: {
    current: number;
    schedule: PaySchedule;
    acquired?: string;
    minDaysAt?: (m: string) => number;
    partAt?: (m: string) => boolean;
    pension?: boolean;
  },
) {
  const payrolls = new Map(
    (['04', '05', '06'] as const)
      .filter((m) => months[m])
      .map((m) => slip(`2026-${m}`, months[m]!.lines, { days: months[m]!.days, inKind: months[m]!.inKind })),
  );
  const acquired = o.acquired ?? '2020-04-01';
  const e = emp(acquired);
  if (o.pension === false) e.pension = { enrolled: true, acquiredDate: acquired, lostDate: '2026-04-09' };
  return decideRegular({
    year: 2026,
    employee: e,
    payrolls,
    remunerations: [rem('2025-09', o.current)],
    grades: GRADES,
    schedule: o.schedule,
    minDaysAt: o.minDaysAt,
    partAt: o.partAt,
  });
}
const used = (r: ReturnType<typeof regular8>) => r.months.map((m) => (m.used ? m.amount : m.skip));
const k = (r: ReturnType<typeof regular8>) => [r.average, r.next!.health.standard / 1000, r.next!.pension ? r.next!.pension.standard / 1000 : null];
const D20_25: PaySchedule = { closingDay: 20, payDay: 25, payMonth: 'current' };

describe('ガイドブック ケース①：一般的な例（3か月とも17日以上）', () => {
  it('671,000円 → 健保 680千円・厚年 650千円（上限）', () => {
    const m = rowsOf([['基本給', 610000], ['家族手当', 20000], ['住宅手当', 30000], ['通勤手当', 11000]], 31);
    const r = regular8({ '04': m, '05': { ...m, days: 30 }, '06': m }, { current: 680, schedule: D20_25 });
    expect(k(r)).toEqual([671000, 680, 650]);
  });
});

describe('ガイドブック ケース②：17日未満の月がある（昼食は現物）', () => {
  it('5月（10日）を除き、4・6月で 267,500円 → 260千円', () => {
    const r = regular8(
      {
        '04': rowsOf([['基本給', 242000], ['住宅手当', 5000], ['通勤手当', 8000], ['残業手当', 12000]], 31, { inKind: 4000 }),
        '05': rowsOf([['基本給', 110000], ['住宅手当', 5000], ['通勤手当', 8000]], 10, { inKind: 1000 }),
        '06': rowsOf([['基本給', 242000], ['住宅手当', 5000], ['通勤手当', 8000], ['残業手当', 5000]], 31, { inKind: 4000 }),
      },
      { current: 240, schedule: D20_25 },
    );
    expect(used(r)).toEqual([271000, 'shortDays', 264000]);
    expect(k(r)).toEqual([267500, 260, 260]);
  });
});

describe('ガイドブック ケース③：短時間就労者（パート。4分の3以上）', () => {
  const part = { current: 118, schedule: D20_25, partAt: () => true };
  const b = (v: number, d: number) => rowsOf([['基本給', v]], d);
  it('17日以上の月（6月）だけ → 130,300円', () => {
    const r = regular8({ '04': b(108600, 14), '05': b(115800, 16), '06': b(130300, 18) }, part);
    expect(used(r)).toEqual(['shortDays', 'shortDays', 130300]);
    expect(r.average).toBe(130300);
  });
  it('3か月とも17日未満 → 15日以上の5・6月 → 100,750円', () => {
    const r = regular8({ '04': b(78000, 12), '05': b(97500, 15), '06': b(104000, 16) }, { ...part, current: 104 });
    expect(used(r)).toEqual(['shortDays', 97500, 104000]);
    expect(r.average).toBe(100750);
  });
});

describe('ガイドブック ケース④：短時間労働者（特定適用事業所。11日以上）', () => {
  const b = (v: number, d: number) => rowsOf([['基本給', v]], d);
  const short = { current: 118, schedule: D20_25, minDaysAt: () => 11 };
  it('3か月とも11日以上 → 115,800円', () => {
    expect(regular8({ '04': b(108600, 11), '05': b(115800, 12), '06': b(123000, 13) }, short).average).toBe(115800);
  });
  it('11日未満の月（4月）を除く → 112,200円', () => {
    expect(regular8({ '04': b(101400, 10), '05': b(108600, 11), '06': b(115800, 12) }, short).average).toBe(112200);
  });
  it('4・5月 短時間、6月 一般（17日）→ 月ごとの区分の日数で、3か月とも使う → 125,400円', () => {
    const r = regular8({ '04': b(108600, 11), '05': b(115800, 12), '06': b(151800, 17) }, { ...short, minDaysAt: (m) => (m === '2026-06' ? 17 : 11) });
    expect(r.average).toBe(125400);
  });
  it('5/1 に一般 → 短時間（日給・25日締め当月末払い）：4月は一般で16日なので除く → 112,200円', () => {
    const r = regular8(
      { '04': b(144600, 16), '05': b(108600, 11), '06': b(115800, 12) },
      { current: 104, schedule: { closingDay: 25, payDay: 31, payMonth: 'current' }, minDaysAt: (m) => (m === '2026-04' ? 17 : 11) },
    );
    expect(used(r)).toEqual(['shortDays', 108600, 115800]);
    expect(r.average).toBe(112200);
  });
});

describe('ガイドブック ケース⑤：計算期間の途中から入社（4/1 入社・20日締め翌月10日払い）', () => {
  it('5月払い（4/1〜4/20）は除き、6月払い（4/21〜5/20）だけ → 200,000円 → 200千円', () => {
    const r = regular8(
      { '04': null, '05': rowsOf([['基本給', 148000]], 20), '06': rowsOf([['基本給', 200000]], 30) },
      { current: 200, schedule: { closingDay: 20, payDay: 10, payMonth: 'next' }, acquired: '2026-04-01' },
    );
    expect(used(r)).toEqual(['beforeAcquisition', 'partialAcquisition', 200000]);
    expect(k(r)).toEqual([200000, 200, 200]);
  });
});

describe('ガイドブック ケース⑥：算定の期間の途中で70歳（4/9 到達・月末締め翌月15日払い）', () => {
  it('健康保険は3か月の平均 297,730円 → 300千円。厚年の資格はないので出さない', () => {
    const b = (v: number, d: number) => rowsOf([['基本給', v]], d);
    const r = regular8(
      { '04': b(326500, 31), '05': b(284550, 30), '06': b(282140, 31) },
      { current: 320, schedule: { closingDay: 31, payDay: 15, payMonth: 'next' }, pension: false },
    );
    expect(k(r)).toEqual([297730, 300, null]);
  });
  it('70歳以上被用者の相当額は、70歳到達日（4/9）以後の計算期間の月（6月払い 5/1〜5/31）だけ → 282,140円 → 280千円', () => {
    const b = (v: number, d: number) => rowsOf([['基本給', v]], d);
    const r = regular8(
      { '04': b(326500, 31), '05': b(284550, 30), '06': b(282140, 31) },
      { current: 320, schedule: { closingDay: 31, payDay: 15, payMonth: 'next' }, pension: false },
    );
    const o = over70Basis(r.months, { closingDay: 31, payDay: 15, payMonth: 'next' }, '2026-04-09')!;
    expect(o).toEqual({ months: ['2026-06'], average: 282140 });
    expect(GRADES.pension.filter((g) => g.min <= o.average).at(-1)!.standard).toBe(280000);
  });
});

describe('ガイドブック：昇給差額が支給されたとき（随時改定。月末締め翌月15日払い）', () => {
  // 4月分から 200,000 → 230,000円。4月分の差額 30,000円を5月15日に払った
  const pays = [
    slip('2026-04', [['基本給', 200000], ['残業手当', 10600]], { gross: 210600 }),
    slip('2026-05', [['基本給', 230000], ['昇給差額', 30000], ['残業手当', 23600]], { gross: 283600, days: 30 }),
    slip('2026-06', [['基本給', 230000], ['残業手当', 27300]], { gross: 257300 }),
    slip('2026-07', [['基本給', 230000], ['残業手当', 25400]], { gross: 255400, days: 30 }),
  ];
  it('5月が起算月。修正平均 255,433円 → 8月から 260千円（従前 220千円から2等級）', () => {
    const map = new Map(pays);
    const r = findStartMonths(map).map((start) =>
      judgeIrregular({ start, payrolls: map, remunerations: [rem('2025-09', 220)], gradesAt: () => GRADES, minDaysAt: () => 17, pensionAt: () => true }),
    );
    expect(r.map((x) => `${x.start.month}:${x.status}`)).toEqual(['2026-05:candidate']);
    expect(r[0].revisedFrom).toBe('2026-08');
    expect(r[0].health!.after!.standard).toBe(260000);
    expect(r[0].average).toEqual({ total: 796300, retro: 30000, average: 265433, corrected: 255433 });
  });
});

// ===== 定時決定及び随時改定の事務取扱いに関する事例集（11/25） =====
// 出典 C：https://www.nenkin.go.jp/service/kounen/hokenryo/hoshu/20121017.files/jireisyu.pdf

describe('事例集 一時帰休（定時決定）問7：9月以降において受けるべき報酬（7月に解消）', () => {
  const p = (m: string, cash: number, furlough = false): [string, Payroll] =>
    [m, { ...emptyPayrollInput(), officeId: 'o', employeeId: 'e', paidMonth: m, cash, fixed: cash, days: 31, state: furlough ? 'furlough' : 'normal' }];
  const run = (pays: [string, Payroll][], rems: Remuneration[]) =>
    decideRegular({ year: 2026, employee: emp('2020-04-01'), payrolls: new Map(pays), remunerations: rems, grades: GRADES, schedule: NEXT_MONTH_PAY });
  const july = p('2026-07', 300000);
  it('例1：4・5月が通常、6月が休業手当 → 4・5月の平均', () => {
    const r = run([p('2026-04', 300000), p('2026-05', 320000), p('2026-06', 180000, true), july], [rem('2025-09', 300)]);
    expect([r.average, r.next!.health.standard]).toEqual([310000, 320000]);
  });
  it('例2：4月が通常、5・6月が休業手当 → 4月の報酬', () => {
    const r = run([p('2026-04', 300000), p('2026-05', 180000, true), p('2026-06', 180000, true), july], [rem('2025-09', 300)]);
    expect(r.average).toBe(300000);
  });
  it('例3：4〜6月とも休業手当 → 休業手当で下げた改定（2026年4月分から 180千円）を飛ばし、その前の 300千円で決定', () => {
    // 2026年1月から一時帰休。1〜3月の休業手当で、4月分から 180千円に随時改定していた
    const pays = [p('2026-01', 180000, true), p('2026-02', 180000, true), p('2026-03', 180000, true),
      p('2026-04', 180000, true), p('2026-05', 180000, true), p('2026-06', 180000, true), july];
    const r = run(pays, [rem('2025-09', 300), { ...rem('2026-04', 180), reason: 'irregular' }]);
    expect([r.status, r.next!.health.standard, r.change, r.restoredFrom]).toEqual(['decided', 300000, 'up', '2025-09']);
  });
  it('例3で、一時帰休の改定がない人は、今のまま（従前のまま）', () => {
    const pays = [p('2026-04', 180000, true), p('2026-05', 180000, true), p('2026-06', 180000, true), july];
    const r = run(pays, [rem('2025-09', 300)]);
    expect([r.status, r.next!.health.standard, r.restoredFrom]).toEqual(['keep', 300000, null]);
  });
});

describe('事例集 随時改定 問7：固定的賃金の変動の翌月に締め日を変えた（月末締め → 15日締め、翌月15日払い）', () => {
  const b = (m: string, base: number, days: number, more: Line[] = []) => slip(m, [['基本給', base], ...more], { days });
  const judge = (pays: [string, Payroll][]) => {
    const map = new Map(pays);
    return findStartMonths(map, [], { minDaysAt: () => 17 }).map((start) => {
      const r = judgeIrregular({ start, payrolls: map, remunerations: [rem('2025-09', 300)], gradesAt: () => GRADES, minDaysAt: () => 17, pensionAt: () => true });
      return `${start.month}:${start.direction}:${r.status}`;
    });
  };
  it('9月の起算は10月（9/1〜9/15 の15日）が17日未満で対象外。11月を起算月にもしない', () => {
    const pays = [b('2026-08', 300000, 31), b('2026-09', 360000, 31), b('2026-10', 180000, 15), b('2026-11', 360000, 30), b('2026-12', 360000, 30), b('2027-01', 360000, 31)];
    expect(judge(pays)).toEqual(['2026-09:up:shortDays', '2026-10:down:shortDays']);
  });
  it('短い月の次の月に本当に昇給していれば、その月は起算月', () => {
    const pays = [b('2026-09', 360000, 31), b('2026-10', 180000, 15), b('2026-11', 380000, 30), b('2026-12', 380000, 30), b('2027-01', 380000, 31)];
    expect(judge(pays)).toContain('2026-11:up:candidate');
  });
  it('昇給した月に欠勤が多くて17日未満でも、次の月を起算月にずらさない（欠勤控除は引く前の額で比べる）', () => {
    const pays = [b('2026-04', 300000, 31), b('2026-05', 360000, 16, [['欠勤控除', 150000]]), b('2026-06', 360000, 30), b('2026-07', 360000, 31)];
    expect(judge(pays)).toEqual(['2026-05:up:shortDays']);
  });
});

describe('事例集 随時改定 問14：産休の間、基本給は払うが通勤手当は払わない（月末締め当月25日払い）', () => {
  const work = (m: string) => slip(m, [['基本給', 300000], ['通勤手当', 50000]]);
  const leave = (m: string) => slip(m, [['基本給', 300000]]);
  const pays = [work('2026-01'), work('2026-02'), work('2026-03'), leave('2026-04'), leave('2026-05'), leave('2026-06'), leave('2026-07'), work('2026-08'), work('2026-09')];
  // 産休 2026-04-01〜2026-07-31
  const inLeave = (m: string) => m >= '2026-04' && m <= '2026-07';
  it('休業の月を見なければ、通勤手当がなくなった4月を「下がった」起算月にしてしまう（直す前）', () => {
    expect(starts(pays)).toEqual(['2026-04:down:fixed', '2026-08:up:fixed']);
  });
  it('休業にかかる月は起算月にも比べる相手にもしない → 起算月なし（○ 賃金体系の変更ではない）', () => {
    expect(findStartMonths(new Map(pays), [], { leaveAt: inLeave })).toEqual([]);
  });
});

describe('ガイドブック ケース⑧：一時帰休による休業手当（20日締め当月25日払い）', () => {
  const p = (m: string, base: number, ot: number, days: number, furlough: boolean): [string, Payroll] => {
    const [, x] = slip(m, [['基本給', base], ['残業手当', ot]], { days });
    return [m, { ...x, state: furlough ? 'furlough' : 'normal' }];
  };
  const run = (pays: [string, Payroll][]) =>
    decideRegular({ year: 2026, employee: emp('2020-04-01'), payrolls: new Map(pays), remunerations: [rem('2025-09', 280)], grades: GRADES, schedule: D20_25 });
  it('7/1 に解消していない：6月の休業手当も含めて3か月 → 総計 732,600・平均 244,200円', () => {
    const r = run([p('2026-04', 272000, 10600, 31, false), p('2026-05', 272000, 5900, 30, false), p('2026-06', 169000, 3100, 31, true), p('2026-07', 169000, 0, 30, true)]);
    expect(regularFormAmounts(r)).toEqual({ total: 732600, average: 244200, corrected: null });
    expect(r.next!.health.standard).toBe(240000);
  });
  it('7/1 に解消：⑭⑮は3か月（709,900・236,633円）、⑯修正平均は4月を除いた 274,550円 → 280千円', () => {
    const r = run([p('2026-04', 160800, 0, 31, true), p('2026-05', 268000, 4000, 30, false), p('2026-06', 268000, 9100, 31, false)]);
    expect(regularFormAmounts(r)).toEqual({ total: 709900, average: 236633, corrected: 274550 });
    expect(r.next!.health.standard).toBe(280000);
  });
  it('4〜6月とも休業手当で解消：⑭⑮は3か月、⑯は空（決定は一時帰休前の標準報酬）', () => {
    const r = run([p('2026-04', 160000, 0, 31, true), p('2026-05', 160000, 0, 30, true), p('2026-06', 160000, 0, 31, true), p('2026-07', 272000, 0, 30, false)]);
    expect(regularFormAmounts(r)).toEqual({ total: 480000, average: 160000, corrected: null });
  });
});
