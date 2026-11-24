/**
 * 並行稼働の検算（11/24）
 * 最終テストの約100人（seed/test-data/1120-final）を、取り込み → 随時改定 → 定時決定 → 保険料・賞与 まで画面と同じ部品に流し、
 * アプリとは別に Python で計算した「こうなるはず」（gen.py）と1円まで比べる。
 * 計算の部品を直したら、ここが落ちないかを見る。材料を作り直すとき：scripts/make-parallel-fixture.mjs
 */
import { CriteriaDoc } from '../core/models/master';
import { GradeTableDoc, MasterRateDoc } from '../core/models/rates';
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

describe('並行稼働の検算（最終テスト 約100人・gen.py と比べる）', () => {
  let r: ParallelRunResult;
  beforeAll(() => {
    r = runParallel({
      office: OFFICE,
      master: PARALLEL_FIXTURE.master as unknown as MasterRateDoc[],
      gradeTables: PARALLEL_FIXTURE.gradeTables as unknown as GradeTableDoc[],
      criteria: PARALLEL_FIXTURE.criteria as unknown as CriteriaDoc[],
      csv: PARALLEL_FIXTURE.csv,
      regularYear: 2026,
      months: MONTHS,
    });
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

  it('事業所の合計：会社負担 ＝ 納付額 − 本人負担の合計（毎月）', () => {
    for (const [, totals] of r.totals) {
      for (const t of totals) expect(t.employerYen).toBe(t.totalYen - t.employeeYen);
    }
  });
});
