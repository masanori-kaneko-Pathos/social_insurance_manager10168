/**
 * 並行稼働の検算（11/24）
 * 最終テストの約100人（seed/test-data/1120-final）を、取り込み → 随時改定 → 定時決定 → 保険料・賞与 まで画面と同じ部品に流し、
 * アプリとは別に Python で計算した「こうなるはず」（gen.py）と1円まで比べる。
 * 計算の部品を直したら、ここが落ちないかを見る。材料を作り直すとき：scripts/make-parallel-fixture.mjs
 */
import { CriteriaDoc } from '../core/models/master';
import { GradeTableDoc, KumiaiRateInput, MasterRateDoc } from '../core/models/rates';
import { PARALLEL_FIXTURE } from './parallel-run.fixture';
import { ParallelRunResult, runParallel, RunOffice } from './parallel-run';

/** CHECKLIST.md の「1. 事業所を作る」と同じ設定 */
const OFFICE: RunOffice = {
  id: 'office-1120',
  name: '最終テスト 株式会社',
  prefecture: '13',
  healthInsurer: { type: 'kyokai', kumiaiName: null },
  standardHours: { weeklyMinutes: 2400, monthlyDays: 21 },
  specificApplication: { since: '2024-10', voluntary: false, insuredCount: 95 },
  payroll: { closingDay: 31, payDay: 25, payMonth: 'next', deduction: 'next' },
  premium: { method: 'payroll', healthRounding: 'combined' },
  departments: ['総務部', '営業部', '開発部', '製造部', '物流センター'].map((name, i) => ({ id: `d${i}`, name })),
} as unknown as RunOffice;

const MONTHS = [
  '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
  '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11',
];

type Want = 'none' | 'exempt' | { h: number | null; p: number | null; hs: number | null; ps: number | null };

type HP = { h: number | null; p: number | null };
type HPByPerson = Record<string, Record<string, HP>>;
/**
 * 設定を変えた予想の毎月の本人負担：fixture には基本の予想と違う所だけが入っている（小さくするため）。
 * 書いていない人・月は基本の予想と同じ
 */
function wantAll(diff: HPByPerson): HPByPerson {
  const out: HPByPerson = {};
  for (const [no, byMonth] of Object.entries(PARALLEL_FIXTURE.expected.monthly as Record<string, Record<string, Want>>)) {
    for (const [m, x] of Object.entries(byMonth)) {
      if (x === 'none' || x === 'exempt') continue;
      (out[no] ??= {})[m] = diff[no]?.[m] ?? { h: x.h, p: x.p };
    }
  }
  return out;
}

const inputOf = (office: RunOffice) => ({
  office,
  master: PARALLEL_FIXTURE.master as unknown as MasterRateDoc[],
  gradeTables: PARALLEL_FIXTURE.gradeTables as unknown as GradeTableDoc[],
  criteria: PARALLEL_FIXTURE.criteria as unknown as CriteriaDoc[],
  csv: PARALLEL_FIXTURE.csv,
  regularYear: 2026,
  months: MONTHS,
});

describe('並行稼働の検算（最終テスト 約100人・gen.py と比べる）', () => {
  let r: ParallelRunResult;
  beforeAll(() => {
    r = runParallel(inputOf(OFFICE));
  });

  it('取り込み・計算で止まった行がない', () => {
    expect(r.problems).toEqual([]);
  });

  it('毎月の本人負担・標準報酬が、予想とすべて一致する', () => {
    const diffs: string[] = [];
    let n = 0;
    for (const [no, byMonth] of Object.entries(PARALLEL_FIXTURE.expected.monthly as Record<string, Record<string, Want>>)) {
      for (const [m, want] of Object.entries(byMonth)) {
        n++;
        const a = r.months.get(no)?.get(m);
        const got: Want =
          !a || a.state === 'none'
            ? 'none'
            : a.state === 'exempt'
              ? 'exempt'
              : { h: a.healthYen, p: a.pensionYen, hs: a.healthStd, ps: a.pensionStd };
        if (JSON.stringify(got) !== JSON.stringify(want)) diffs.push(`${no} ${m}: 予想 ${JSON.stringify(want)} / アプリ ${JSON.stringify(got)}`);
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(diffs).toEqual([]);
  });

  it('賞与の本人負担が、予想とすべて一致する', () => {
    const diffs: string[] = [];
    for (const b of PARALLEL_FIXTURE.expected.bonus as { no: string; paid: string; h: number | null; p: number | null }[]) {
      const a = r.bonuses.find((x) => x.employeeNumber === b.no && x.paidDate === b.paid);
      const got = { h: a?.healthYen ?? null, p: a?.pensionYen ?? null };
      if (got.h !== b.h || got.p !== b.p) diffs.push(`${b.no} ${b.paid}: 予想 ${JSON.stringify({ h: b.h, p: b.p })} / アプリ ${JSON.stringify(got)}`);
    }
    expect(PARALLEL_FIXTURE.expected.bonus.length).toBeGreaterThan(0);
    expect(diffs).toEqual([]);
  });

  it('毎月の事業所の納付額（告知額にあたる数字）と本人負担の合計が、予想とすべて一致する', () => {
    type T = Record<string, Record<string, { total: number; employee: number; separate: number }>>;
    const want = PARALLEL_FIXTURE.expected.totals as unknown as T;
    const diffs: string[] = [];
    for (const m of MONTHS) {
      for (const t of r.totals.get(m) ?? []) {
        const w = want[m]?.[t.category];
        if (!w || w.total !== t.totalYen || w.employee !== t.employeeYen)
          diffs.push(`${m} ${t.category}: 予想 ${JSON.stringify(w)} / アプリ ${t.totalYen}・本人 ${t.employeeYen}`);
      }
    }
    expect(diffs).toEqual([]);
  });

  it('賞与の月は、月額と賞与を足してから切り捨てる（2025-12分の拠出金：別々に切り捨てると1円少ない）', () => {
    type T = Record<string, Record<string, { total: number; separate: number }>>;
    const dec = (PARALLEL_FIXTURE.expected.totals as unknown as T)['2025-12']['childContribution'];
    const app = r.totals.get('2025-12')!.find((t) => t.category === 'childContribution')!;
    expect(dec.separate).toBe(dec.total - 1);
    expect(app.totalYen).toBe(dec.total);
  });

  it('事業所の合計：会社負担 ＝ 納付額 − 本人負担の合計（毎月）', () => {
    for (const [, totals] of r.totals) {
      for (const t of totals) expect(t.employerYen).toBe(t.totalYen - t.employeeYen);
    }
  });
});

/**
 * 端数処理の設定を変えた並行稼働（11/24）
 * 現金払い・それぞれ端数処理・特約（四捨五入・切り捨て・切り上げ）で、1人ずつの本人負担と本人負担の合計が予想と一致し、
 * 事業所の納付額（全額を足して1回切り捨て）は設定に関係なく同じであることを確かめる
 */
describe('並行稼働の検算：端数処理の設定を変える', () => {
  type Variant = {
    settings: { method: 'payroll' | 'cash'; agreement: 'half' | 'floor' | 'ceil' | null; separate: boolean };
    monthly: Record<string, Record<string, { h: number | null; p: number | null }>>;
    bonus: { no: string; paid: string; h: number | null; p: number | null }[];
    employeeTotals: Record<string, Record<string, number>>;
  };
  const variants = PARALLEL_FIXTURE.expected.variants as unknown as Record<string, Variant>;
  type T = Record<string, Record<string, { total: number }>>;
  const baseTotals = PARALLEL_FIXTURE.expected.totals as unknown as T;

  for (const [name, v] of Object.entries(variants)) {
    it(`${name}：本人負担（毎月・賞与）と本人負担の合計が予想と一致し、納付額は変わらない`, () => {
      const office = {
        ...OFFICE,
        premium: {
          method: v.settings.method,
          healthRounding: v.settings.separate ? 'separate' : 'combined',
          agreementRounding: v.settings.agreement,
        },
      } as unknown as RunOffice;
      const r = runParallel(inputOf(office));
      const diffs: string[] = [];
      for (const [no, byMonth] of Object.entries(wantAll(v.monthly))) {
        for (const [m, want] of Object.entries(byMonth)) {
          const a = r.months.get(no)?.get(m);
          if (a?.healthYen !== want.h || a?.pensionYen !== want.p)
            diffs.push(`${no} ${m}: 予想 ${JSON.stringify(want)} / アプリ ${JSON.stringify({ h: a?.healthYen, p: a?.pensionYen })}`);
        }
      }
      for (const b of v.bonus) {
        const a = r.bonuses.find((x) => x.employeeNumber === b.no && x.paidDate === b.paid);
        if ((a?.healthYen ?? null) !== b.h || (a?.pensionYen ?? null) !== b.p)
          diffs.push(`賞与 ${b.no} ${b.paid}: 予想 ${JSON.stringify({ h: b.h, p: b.p })} / アプリ ${JSON.stringify({ h: a?.healthYen, p: a?.pensionYen })}`);
      }
      for (const m of MONTHS) {
        for (const t of r.totals.get(m) ?? []) {
          if (t.employeeYen !== v.employeeTotals[m][t.category]) diffs.push(`${m} ${t.category} 本人負担の合計: 予想 ${v.employeeTotals[m][t.category]} / アプリ ${t.employeeYen}`);
          if (t.totalYen !== baseTotals[m][t.category].total) diffs.push(`${m} ${t.category} 納付額が設定で変わった: ${t.totalYen}`);
        }
      }
      expect(r.problems).toEqual([]);
      expect(diffs).toEqual([]);
    });
  }
});

/**
 * 途中から組合健保（2026-08分から。11/24）
 * 組合の料率（本人分と会社分が違う）で健保等を計算し、賞与の年度の上限は保険者が変わったら数え直す（S43：決算賞与は200万円まで数える）
 */
describe('並行稼働の検算：途中から組合健保', () => {
  type K = {
    since: string;
    rates: Record<'health' | 'care' | 'child', [string, string]>;
    monthly: Record<string, Record<string, { h: number | null; p: number | null }>>;
    bonus: { no: string; paid: string; h: number | null; p: number | null }[];
    totals: Record<string, Record<string, { total: number; employee: number }>>;
  };
  const k = PARALLEL_FIXTURE.expected.kumiai as unknown as K;
  /** '4.30' → 43000（0.0001% を 1 とする整数） */
  const micro = (s: string) => Math.round(Number(s) * 10000);
  const split = ([e, r]: [string, string]) => ({ employee: micro(e), employer: micro(r) });

  it('2026-08分から組合の料率：本人負担・賞与・事業所の納付額が予想と一致する', () => {
    const office = {
      ...OFFICE,
      healthInsurer: { type: 'kumiai', kumiaiName: 'テスト精機健康保険組合' },
      insurerHistory: [
        { from: '0000-01', prefecture: '13', healthInsurer: { type: 'kyokai', kumiaiName: null } },
        { from: k.since, prefecture: '13', healthInsurer: { type: 'kumiai', kumiaiName: 'テスト精機健康保険組合' } },
      ],
    } as unknown as RunOffice;
    const kumiai: KumiaiRateInput[] = [
      { from: k.since, health: split(k.rates.health), care: split(k.rates.care), childSupport: split(k.rates.child) },
    ];
    const r = runParallel({ ...inputOf(office), kumiai });
    const diffs: string[] = [];
    for (const [no, byMonth] of Object.entries(wantAll(k.monthly))) {
      for (const [m, want] of Object.entries(byMonth)) {
        const a = r.months.get(no)?.get(m);
        if (a?.healthYen !== want.h || a?.pensionYen !== want.p)
          diffs.push(`${no} ${m}: 予想 ${JSON.stringify(want)} / アプリ ${JSON.stringify({ h: a?.healthYen, p: a?.pensionYen })}`);
      }
    }
    for (const b of k.bonus) {
      const a = r.bonuses.find((x) => x.employeeNumber === b.no && x.paidDate === b.paid);
      if ((a?.healthYen ?? null) !== b.h || (a?.pensionYen ?? null) !== b.p)
        diffs.push(`賞与 ${b.no} ${b.paid}: 予想 ${JSON.stringify({ h: b.h, p: b.p })} / アプリ ${JSON.stringify({ h: a?.healthYen, p: a?.pensionYen })}`);
    }
    for (const m of MONTHS) {
      for (const t of r.totals.get(m) ?? []) {
        const w = k.totals[m][t.category];
        if (t.totalYen !== w.total || t.employeeYen !== w.employee) diffs.push(`${m} ${t.category}: 予想 ${JSON.stringify(w)} / アプリ ${t.totalYen}・本人 ${t.employeeYen}`);
      }
    }
    expect(r.problems).toEqual([]);
    expect(diffs).toEqual([]);
  });

  it('S43 の決算賞与（2026-11-10）は、保険者が変わったので年度の累計を数え直し、200万円で計算する', () => {
    const b = k.bonus.find((x) => x.no === 'S43' && x.paid === '2026-11-10')!;
    expect(b.h).toBe(105300); // 2,000,000 × 5.265%（組合の本人分：健保 4.30%・介護 0.85%・支援金 0.115%）
  });
});

/**
 * 都道府県の移転（2026-09分から 東京 → 大阪。協会けんぽのまま。夏の賞与と決算賞与のあいだ。11/24）
 * 移った月から大阪の料率。協会けんぽは同じ保険者なので、賞与の年度の累計は数え直さない（S43 の決算賞与は 173万円まで）
 */
describe('並行稼働の検算：都道府県の移転', () => {
  type V = {
    since: string;
    prefecture: string;
    monthly: Record<string, Record<string, { h: number | null; p: number | null }>>;
    bonus: { no: string; paid: string; h: number | null; p: number | null; healthStd: number }[];
    totals: Record<string, Record<string, { total: number; employee: number }>>;
  };
  const v = PARALLEL_FIXTURE.expected.move as unknown as V;

  it('2026-09分から大阪の料率：本人負担・賞与・事業所の納付額が予想と一致する', () => {
    const office = {
      ...OFFICE,
      prefecture: v.prefecture,
      insurerHistory: [
        { from: '0000-01', prefecture: '13', healthInsurer: { type: 'kyokai', kumiaiName: null } },
        { from: v.since, prefecture: v.prefecture, healthInsurer: { type: 'kyokai', kumiaiName: null } },
      ],
    } as unknown as RunOffice;
    const r = runParallel(inputOf(office));
    const diffs: string[] = [];
    for (const [no, byMonth] of Object.entries(wantAll(v.monthly))) {
      for (const [m, want] of Object.entries(byMonth)) {
        const a = r.months.get(no)?.get(m);
        if (a?.healthYen !== want.h || a?.pensionYen !== want.p)
          diffs.push(`${no} ${m}: 予想 ${JSON.stringify(want)} / アプリ ${JSON.stringify({ h: a?.healthYen, p: a?.pensionYen })}`);
      }
    }
    for (const b of v.bonus) {
      const a = r.bonuses.find((x) => x.employeeNumber === b.no && x.paidDate === b.paid);
      if ((a?.healthYen ?? null) !== b.h || (a?.pensionYen ?? null) !== b.p)
        diffs.push(`賞与 ${b.no} ${b.paid}: 予想 ${JSON.stringify({ h: b.h, p: b.p })} / アプリ ${JSON.stringify({ h: a?.healthYen, p: a?.pensionYen })}`);
    }
    for (const m of MONTHS) {
      for (const t of r.totals.get(m) ?? []) {
        const w = v.totals[m][t.category];
        if (t.totalYen !== w.total || t.employeeYen !== w.employee) diffs.push(`${m} ${t.category}: 予想 ${JSON.stringify(w)} / アプリ ${t.totalYen}・本人 ${t.employeeYen}`);
      }
    }
    expect(r.problems).toEqual([]);
    expect(diffs).toEqual([]);
  });

  it('S43 の決算賞与は、協会けんぽのままなので年度の累計を続けて数え、173万円で止まる', () => {
    expect(v.bonus.find((x) => x.no === 'S43' && x.paid === '2026-11-10')!.healthStd).toBe(1730000);
  });
});

/**
 * 控除の時期（翌月控除・当月控除・途中での切り替え。11/24）
 * 保険料の額は変わらず、どの給与から何月分を引くかだけが変わる。切り替えた月の給与は2か月分か0か月分
 */
describe('並行稼働の検算：控除の時期', () => {
  type D = {
    setting: 'current' | 'next';
    history: { from: string; deduction: 'current' | 'next' }[] | null;
    /** 給与を払う月 → 何月分を引くか（全員同じ） */
    pays: Record<string, string[]>;
    /** 人 → 給与を払う月 → 引く額 */
    yen: Record<string, Record<string, number>>;
  };
  const ds = PARALLEL_FIXTURE.expected.deductions as unknown as Record<string, D>;
  for (const [name, d] of Object.entries(ds)) {
    it(`${name}：給与の月ごとに、控除する保険料の月と額が予想と一致する`, () => {
      const office = {
        ...OFFICE,
        payroll: { closingDay: 31, payDay: 25, payMonth: 'next', deduction: d.setting },
        deductionHistory: d.history,
      } as unknown as RunOffice;
      const r = runParallel(inputOf(office));
      const diffs: string[] = [];
      for (const [no, byPay] of Object.entries(d.yen)) {
        const got = r.deductions.get(no);
        const gotKeys = [...(got?.keys() ?? [])].sort();
        const wantKeys = Object.keys(byPay).sort();
        if (JSON.stringify(gotKeys) !== JSON.stringify(wantKeys)) diffs.push(`${no} 給与の月: 予想 ${wantKeys.join(',')} / アプリ ${gotKeys.join(',')}`);
        for (const [pay, yen] of Object.entries(byPay)) {
          const a = got?.get(pay);
          const months = d.pays[pay];
          if (!a || JSON.stringify(a.months) !== JSON.stringify(months) || a.yen !== yen)
            diffs.push(`${no} ${pay}払い: 予想 ${JSON.stringify({ months, yen })} / アプリ ${JSON.stringify(a)}`);
        }
      }
      expect(r.problems).toEqual([]);
      expect(diffs).toEqual([]);
    });
  }
});
