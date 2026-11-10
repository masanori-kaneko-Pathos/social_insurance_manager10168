import { MasterRateDoc, RatesForMonth } from '../../../core/models/rates';
import { CoverageInput } from '../../employees/logic/coverage';
import { pickRates } from '../../rates/logic/pick-rates';
import { calcMonthly, RemunerationLike } from './calc-monthly';
import { healthPartTotals, officeTotals } from './premium-core';
import { EXCEL_SAGA, EXCEL_TOKYO } from './excel-r8.fixture';

// 令和8年度の料率（東京 9.85%、佐賀 10.55%、介護 1.62%、支援金 0.23%、厚年 18.3%、拠出金 0.36%）
const MASTER: MasterRateDoc[] = [
  {
    kind: 'kyokaiHealth',
    from: '2025-03',
    byPrefecture: { '13': 99100, '41': 107800 },
    source: 'test',
  },
  {
    kind: 'kyokaiHealth',
    from: '2026-03',
    byPrefecture: { '13': 98500, '41': 105500 },
    source: 'test',
  },
  { kind: 'care', from: '2025-03', rate: 15900, source: 'test' },
  { kind: 'care', from: '2026-03', rate: 16200, source: 'test' },
  { kind: 'childSupport', from: '2024-03', rate: 0, source: 'test' },
  { kind: 'childSupport', from: '2026-04', rate: 2300, source: 'test' },
  { kind: 'pension', from: '2024-03', rate: 183000, source: 'test' },
  { kind: 'childContribution', from: '2024-03', rate: 3600, source: 'test' },
];

const rates = (prefecture: string, month: string): RatesForMonth =>
  pickRates(
    { prefecture, healthInsurer: { type: 'kyokai' } },
    { master: MASTER, kumiai: [] },
    month,
  );

const enrolled = (acquiredDate: string, lostDate: string | null = null) => ({
  enrolled: true,
  acquiredDate,
  lostDate,
});

/** 30歳（介護なし）と 50歳（介護あり）の人 */
const AGE30: CoverageInput = {
  birthDate: '1996-05-15',
  health: enrolled('2024-04-01'),
  pension: enrolled('2024-04-01'),
};
const AGE50: CoverageInput = {
  birthDate: '1976-05-15',
  health: enrolled('2024-04-01'),
  pension: enrolled('2024-04-01'),
};

/** 標準報酬（健保の等級と厚年の等級） */
const rem = (from: string, h: [number, number], p: [number, number]): RemunerationLike => ({
  from,
  health: { grade: h[0], standard: h[1] },
  pension: { grade: p[0], standard: p[1] },
});

/** 厚年の標準報酬月額は 88,000〜650,000円 */
const pensionOf = (standard: number): [number, number] => [
  0,
  Math.min(Math.max(standard, 88000), 650000),
];

describe('calcMonthly：協会けんぽの保険料額表（Excel）と全額が一致する', () => {
  for (const [label, table, pref] of [
    ['東京', EXCEL_TOKYO, '13'],
    ['佐賀', EXCEL_SAGA, '41'],
  ] as const) {
    it(`${label}：全50等級で、健保・介護・支援金・厚年の全額が1厘の違いもなく一致`, () => {
      for (const [grade, standard, health, healthCare, support, pension] of table) {
        const r = calcMonthly({
          month: '2026-11',
          employee: AGE50,
          remunerations: [rem('2024-04', [grade, standard], pensionOf(standard))],
          rates: rates(pref, '2026-11'),
          options: { method: 'payroll', healthRounding: 'separate' },
        });
        const total = (part: string) =>
          r.groups.flatMap((g) => g.lines).find((l) => l.part === part)!.totalMilli;
        expect(total('health')).toBe(health);
        expect(total('health') + total('care')).toBe(healthCare);
        expect(total('childSupport')).toBe(support);
        if (pension !== null) expect(total('pension')).toBe(pension);
      }
    });
  }
});

describe('calcMonthly：本人負担と会社負担', () => {
  const tokyo22 = [rem('2024-04', [22, 300000], [19, 300000])];

  it('東京22級・30歳（介護なし）：健保＋支援金 15,120円、厚年 27,450円', () => {
    const r = calcMonthly({
      month: '2026-11',
      employee: AGE30,
      remunerations: tokyo22,
      rates: rates('13', '2026-11'),
    });
    expect(r.groups.map((g) => g.parts)).toEqual([
      ['health', 'childSupport'],
      ['pension'],
      ['childContribution'],
    ]);
    expect(r.groups[0].employeeYen).toBe(15120); // (29,550 + 690) ÷ 2
    expect(r.groups[1].employeeYen).toBe(27450);
    expect(r.groups[2].employeeYen).toBe(0); // 拠出金は会社だけ
    expect(r.groups[2].employerMilli).toBe(1080000); // 300,000 × 0.36%
    expect(r.employeeYen).toBe(42570);
    expect(r.missing).toEqual([]);
  });

  it('東京22級・50歳（介護あり）：健保＋介護＋支援金 17,550円', () => {
    const r = calcMonthly({
      month: '2026-11',
      employee: AGE50,
      remunerations: tokyo22,
      rates: rates('13', '2026-11'),
    });
    expect(r.groups[0].parts).toEqual(['health', 'care', 'childSupport']);
    expect(r.groups[0].employeeYen).toBe(17550); // (34,410 + 690) ÷ 2
  });

  it('合算と個別で1円変わるケース（佐賀1級：健保 3,059.5円 ＋ 支援金 66.7円）', () => {
    const base = {
      month: '2026-11',
      employee: AGE30,
      remunerations: [rem('2024-04', [1, 58000], [1, 88000])],
      rates: rates('41', '2026-11'),
    };
    const combined = calcMonthly({
      ...base,
      options: { method: 'payroll', healthRounding: 'combined' },
    });
    const separate = calcMonthly({
      ...base,
      options: { method: 'payroll', healthRounding: 'separate' },
    });
    // 合算：3,126.2円 → 3,126円 ／ 個別：3,059円 ＋ 67円 ＝ 3,126円（この等級では同じ）
    expect(combined.groups[0].employeeYen).toBe(3126);
    expect(separate.groups[0].employeeYen + separate.groups[1].employeeYen).toBe(3126);
  });

  it('合算と個別で1円変わる等級がある（東京7級：健保 5,417.5円 ＋ 支援金 126.5円）', () => {
    const base = {
      month: '2026-11',
      employee: AGE30,
      remunerations: [rem('2024-04', [7, 110000], [4, 110000])],
      rates: rates('13', '2026-11'),
    };
    const combined = calcMonthly({
      ...base,
      options: { method: 'payroll', healthRounding: 'combined' },
    });
    const separate = calcMonthly({
      ...base,
      options: { method: 'payroll', healthRounding: 'separate' },
    });
    // 合算：5,544.0円 → 5,544円 ／ 個別：5,417円（5,417.5は切り捨て）＋ 126円（126.5も切り捨て）＝ 5,543円
    expect(combined.groups[0].employeeYen).toBe(5544);
    expect(separate.groups[0].employeeYen).toBe(5417);
    expect(separate.groups[1].employeeYen).toBe(126);
  });

  it('現金払いは 50銭ちょうどで切り上げ（佐賀1級の健保だけ：3,059.5円 → 3,060円）', () => {
    const base = {
      month: '2026-03',
      employee: AGE30,
      remunerations: [rem('2024-04', [1, 58000], [1, 88000])],
      rates: rates('41', '2026-03'),
    };
    // 2026年3月分はまだ支援金がないので、健保だけのグループになる
    expect(
      calcMonthly({ ...base, options: { method: 'payroll', healthRounding: 'combined' } }).groups[0]
        .employeeYen,
    ).toBe(3059);
    expect(
      calcMonthly({ ...base, options: { method: 'cash', healthRounding: 'combined' } }).groups[0]
        .employeeYen,
    ).toBe(3060);
  });

  it('会社負担の目安 ＝ 全額 − 本人負担（小数が出る）', () => {
    const r = calcMonthly({
      month: '2026-03',
      employee: AGE30,
      remunerations: [rem('2024-04', [1, 58000], [1, 88000])],
      rates: rates('41', '2026-03'),
    });
    expect(r.groups[0].totalMilli).toBe(6119000);
    expect(r.groups[0].employerMilli).toBe(3060000); // 6,119 − 3,059
  });
});

describe('calcMonthly：計算できない・かからない月', () => {
  const tokyo22 = [rem('2024-04', [22, 300000], [19, 300000])];

  it('加入していない月は、保険料なし（missing も空）', () => {
    const r = calcMonthly({
      month: '2024-03',
      employee: AGE30,
      remunerations: tokyo22,
      rates: rates('13', '2024-03'),
    });
    expect(r.groups).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.employeeYen).toBe(0);
  });

  it('標準報酬が未登録の月は、0円ではなく「未登録」として返す', () => {
    const r = calcMonthly({
      month: '2026-11',
      employee: AGE30,
      remunerations: [],
      rates: rates('13', '2026-11'),
    });
    expect(r.groups).toEqual([]);
    expect(r.missing.map((m) => m.part)).toEqual([
      'health',
      'childSupport',
      'pension',
      'childContribution',
    ]);
    expect(r.missing.every((m) => m.reason === 'noRemuneration')).toBe(true);
  });

  it('料率が未登録の月は「料率未登録」', () => {
    const r = calcMonthly({
      month: '2026-11',
      employee: AGE30,
      remunerations: tokyo22,
      rates: rates('01', '2026-11'),
    });
    expect(r.missing).toEqual([{ part: 'health', reason: 'noRate' }]);
    expect(r.groups.map((g) => g.parts[0])).toEqual([
      'childSupport',
      'pension',
      'childContribution',
    ]);
  });

  it('支援金が始まる前（2026年3月分）は支援金の行を作らない', () => {
    const r = calcMonthly({
      month: '2026-03',
      employee: AGE30,
      remunerations: tokyo22,
      rates: rates('13', '2026-03'),
    });
    expect(r.groups[0].parts).toEqual(['health']);
  });

  it('標準報酬はその月に一番新しい履歴を使う', () => {
    const history = [
      rem('2024-04', [22, 300000], [19, 300000]),
      rem('2025-09', [23, 320000], [20, 320000]),
    ];
    const before = calcMonthly({
      month: '2025-08',
      employee: AGE30,
      remunerations: history,
      rates: rates('13', '2025-08'),
    });
    const after = calcMonthly({
      month: '2025-09',
      employee: AGE30,
      remunerations: history,
      rates: rates('13', '2025-09'),
    });
    expect(before.groups[0].lines[0].base).toBe(300000);
    expect(after.groups[0].lines[0].base).toBe(320000);
  });
});

describe('officeTotals：事業所の合計（日本年金機構の考え方）', () => {
  it('納付額は全額の合計を切り捨て、会社負担は 納付額 − 本人負担の合計', () => {
    const one = (standard: number, grade: number) =>
      calcMonthly({
        month: '2026-03',
        employee: AGE30,
        remunerations: [rem('2024-04', [grade, standard], [1, 88000])],
        rates: rates('41', '2026-03'),
      });
    // 佐賀1級（6,119円・本人3,059円）と 佐賀3級（78,000 × 10.55% ＝ 8,229円・本人 4,114.5 → 4,114円）
    const totals = officeTotals([one(58000, 1), one(78000, 3)]);
    const health = totals.find((t) => t.category === 'health')!;
    expect(health.totalYen).toBe(14348);
    expect(health.employeeYen).toBe(7173);
    expect(health.employerYen).toBe(7175);
  });
});

describe('healthPartTotals：健康保険料の内訳（全額）', () => {
  it('東京22級（30万円）・2026-11：健保 29,550円・支援金 690円（30歳なので介護は0円）', () => {
    const r = calcMonthly({
      month: '2026-11',
      employee: AGE30,
      remunerations: [rem('2024-04', [22, 300000], [19, 300000])],
      rates: rates('13', '2026-11'),
    });
    expect(healthPartTotals([r])).toEqual([
      { part: 'health', totalYen: 29550 },
      { part: 'care', totalYen: 0 },
      { part: 'childSupport', totalYen: 690 },
    ]);
  });
});

describe('calcMonthly：産休・育休の免除', () => {
  const tokyo22 = [rem('2024-04', [22, 300000], [19, 300000])];
  const leaves = [{ kind: 'childcare' as const, start: '2026-11-10', end: '2027-03-31' }];

  it('免除の月は保険料なし（missing もなし）', () => {
    const r = calcMonthly({
      month: '2026-11',
      employee: { ...AGE30, leaves },
      remunerations: tokyo22,
      rates: rates('13', '2026-11'),
    });
    expect(r.exempt).toBeTrue();
    expect(r.groups).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.employeeYen).toBe(0);
  });

  it('終了日の翌日の月からはかかる', () => {
    const r = calcMonthly({
      month: '2027-04',
      employee: { ...AGE30, leaves },
      remunerations: tokyo22,
      rates: rates('13', '2027-04'),
    });
    expect(r.exempt).toBeFalsy();
    expect(r.employeeYen).toBe(42570);
  });
});
