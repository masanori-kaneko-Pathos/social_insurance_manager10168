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
const totals = exp.totals ?? null;

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
    expected: { monthly, bonus, office, totals },
  },
  null,
  0,
)};
`;
writeFileSync('src/app/testing/parallel-run.fixture.ts', out.replace(/\r?\n/g, '\n'));
console.log('wrote src/app/testing/parallel-run.fixture.ts', out.length, 'chars');
