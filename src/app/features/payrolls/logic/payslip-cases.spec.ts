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
import { inKindAmount } from './in-kind';
import { findStartMonths, judgeIrregular } from './irregular';
import { readEntry, textOf } from './payroll-input';
import { allocateOtherMonths, categoryOf } from './payroll-lines';
import { decideRegular, Remuneration } from './regular';
import { standardBonusOf } from '../../premiums/logic/calc-bonus';
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
  // 4月は入社月。資料の正解（300千円）は5・6月の平均なので、4月21日払いの給与は計算期間の途中からの入社（4月を除く）と読んだ
  // 締め日は資料に書いていない。ここでは15日締め・当月21日払いとした（要確認：原本 p.17）
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
