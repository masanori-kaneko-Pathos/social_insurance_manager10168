// 並行稼働の検算の材料（src/app/testing/parallel-run.fixture.ts）を作る（11/24）
// 使い方：node scripts/make-parallel-fixture.mjs [テストデータのフォルダ]
//   既定は seed/test-data/1120-final。先に python3 -I gen.py . で CSV と expected.json を作っておく
// seed/test-data は git に入れていないので、spec が読めるように CSV・料率・等級表・「こうなるはず」を1つの ts に固める
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'seed/test-data/1120-final';
const read = (f) => readFileSync(join(dir, f), 'utf8').replace(/^﻿/, '');
const json = (f) => JSON.parse(readFileSync(f, 'utf8'));

const exp = JSON.parse(read('expected.json'));
const monthly = {};
for (const [no, e] of Object.entries(exp.expected)) {
  monthly[no] = {};
  for (const [m, x] of Object.entries(e.premium)) {
    monthly[no][m] =
      x === null || x === 'exempt'
        ? (x ?? 'none')
        : { h: x.healthYen ?? null, p: x.pensionYen ?? null, hs: x.healthStd ?? null, ps: x.pensionStd ?? null };
  }
}
const bonus = exp.bonus.map((b) => ({ no: b.no, paid: b.paid, h: b.healthYen ?? null, p: b.pensionYen ?? null }));
const office = exp.office ?? null;

// ---- 小さくする（11/24）：設定を変えた予想は、基本の予想と違う所だけを持つ ----
const baseHP = (no, m) => {
  const x = monthly[no]?.[m];
  return x && typeof x === 'object' ? { h: x.h, p: x.p } : { h: null, p: null };
};
/** 人 → 月 → {h,p} のうち、基本と同じものを落とす */
const onlyDiff = (mon) => {
  const out = {};
  for (const [no, byM] of Object.entries(mon ?? {})) {
    for (const [m, x] of Object.entries(byM)) {
      const b = baseHP(no, m);
      if (b.h !== x.h || b.p !== x.p) (out[no] ??= {})[m] = { h: x.h, p: x.p };
    }
  }
  return out;
};
const variants = exp.variants
  ? Object.fromEntries(Object.entries(exp.variants).map(([k, v]) => [k, { ...v, monthly: onlyDiff(v.monthly) }]))
  : null;
const slim = (v) => (v ? { ...v, monthly: onlyDiff(v.monthly) } : null);
/** 控除：給与の月 → 何月分 は全員同じなので1つだけ。人ごとは額だけ */
const deductions = exp.deductions
  ? Object.fromEntries(
      Object.entries(exp.deductions).map(([k, v]) => {
        const pays = {};
        const yen = {};
        for (const [no, byPay] of Object.entries(v.byPerson)) {
          for (const [pay, x] of Object.entries(byPay)) {
            pays[pay] ??= x.months;
            (yen[no] ??= {})[pay] = x.yen;
          }
        }
        return [k, { setting: v.setting, history: v.history, pays, yen }];
      }),
    )
  : null;
// 事業所の納付額（何月分 → 制度 → 納付額・本人負担の合計・月額と賞与を別々に切り捨てた額）
const totals = exp.totals
  ? Object.fromEntries(
      Object.entries(exp.totals).map(([m, t]) => [
        m,
        Object.fromEntries(Object.entries(t).map(([c, v]) => [c, { total: v.totalYen, employee: v.employeeYen, separate: v.separateYen }])),
      ]),
    )
  : null;

const out = `// 自動で作ったファイル（scripts/make-parallel-fixture.mjs）。手で直さない
// 元：${dir.replace(/\\/g, '/')}（CSV・expected.json）、seed/master-*.json
/* eslint-disable */
export const PARALLEL_FIXTURE = ${JSON.stringify(
  {
    csv: {
      employees: read('1-employees.csv'),
      remunerationHistory: read('2-remuneration-history.csv'),
      payrolls: read('3-payrolls-2025-11_2026-10.csv'),
      bonuses: read('4-bonuses.csv'),
    },
    master: json('seed/master-rates.json'),
    gradeTables: json('seed/master-grades.json'),
    criteria: json('seed/master-criteria.json'),
    expected: { monthly, bonus, office, totals, variants, kumiai: slim(exp.kumiai), move: slim(exp.move), deductions },
  },
  null,
  0,
)};
`;
writeFileSync('src/app/testing/parallel-run.fixture.ts', out.replace(/\r?\n/g, '\n'));
console.log('wrote src/app/testing/parallel-run.fixture.ts', out.length, 'chars');
