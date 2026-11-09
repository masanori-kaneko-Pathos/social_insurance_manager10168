/**
 * 加入の基準（seed/master-criteria.json）を Firestore の masterCriteria に書き込む
 *
 * 使い方（プロジェクトのフォルダで）:
 *   node scripts/seed-criteria.mjs --dry-run   … 中身のチェックと一覧の表示だけ（書き込まない）
 *   node scripts/seed-criteria.mjs             … チェックが通ったら書き込む
 *
 * 書き込みには、事前に `gcloud auth application-default login` が必要（seed-master-rates.mjs と同じ）。
 * アプリからは masterCriteria に書けない（ルールで禁止）ので、書けるのはこのスクリプトだけ。
 */
import { readFileSync } from 'node:fs';

const PROJECT_ID = 'kensyu10168';
const DATABASE_ID = 'socialinsurance-db';
const FILE = new URL('../seed/master-criteria.json', import.meta.url);
const KEYS = ['from', 'sizeMin', 'weeklyMinutesMin', 'wageMin', 'reducedWageMin', 'source'];

const optInt = (v) => v === null || (Number.isSafeInteger(v) && v > 0);

// ===== 1. 中身のチェック（1つでも問題があれば書き込まない） =====
function validate(rows) {
  const errors = [];
  const sorted = [...rows].sort((a, b) => a.from.localeCompare(b.from));
  sorted.forEach((d, i) => {
    const id = d.from;
    const keys = Object.keys(d).sort();
    if (keys.join() !== [...KEYS].sort().join()) errors.push(`${id}: 項目は ${KEYS.join('・')} だけにしてください`);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(d.from)) errors.push(`${id}: from は YYYY-MM で書いてください`);
    if (i > 0 && sorted[i - 1].from === d.from) errors.push(`${id}: 重複しています`);
    if (!optInt(d.sizeMin)) errors.push(`${id}: sizeMin は 1以上の整数か null`);
    if (!Number.isSafeInteger(d.weeklyMinutesMin) || d.weeklyMinutesMin <= 0) errors.push(`${id}: weeklyMinutesMin がおかしい`);
    if (!optInt(d.wageMin)) errors.push(`${id}: wageMin は 1以上の整数か null`);
    if (!optInt(d.reducedWageMin)) errors.push(`${id}: reducedWageMin は 1以上の整数か null`);
    if (typeof d.source !== 'string' || !d.source) errors.push(`${id}: source（出典）がありません`);
    // 企業規模の要件は、ゆるくなる（人数が減る・なくなる）一方のはず
    const prev = sorted[i - 1];
    if (prev && prev.sizeMin === null && d.sizeMin !== null) errors.push(`${id}: 規模の要件が復活しています`);
    if (prev && prev.sizeMin !== null && d.sizeMin !== null && d.sizeMin > prev.sizeMin) {
      errors.push(`${id}: 人数が前の行（${prev.sizeMin}人）より増えています`);
    }
  });
  return errors;
}

// ===== 2. 人が目で確かめるための一覧 =====
const yen = (v) => (v === null ? '—' : `${v.toLocaleString()}円`);
function printSummary(rows) {
  console.log('\n加入の基準（masterCriteria）');
  console.log(['から', '企業規模', '週の時間', '賃金要件', '特定減額特例'].join('\t'));
  for (const d of [...rows].sort((a, b) => a.from.localeCompare(b.from))) {
    console.log([
      `${d.from}〜`,
      d.sizeMin === null ? '要件なし' : `${d.sizeMin}人以上`,
      `${d.weeklyMinutesMin / 60}時間以上`,
      yen(d.wageMin),
      d.reducedWageMin === null ? '—' : `${yen(d.reducedWageMin)}未満は原則対象外`,
    ].join('\t'));
  }
}

// ===== 3. 書き込み =====
async function write(rows) {
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app, DATABASE_ID);

  const batch = db.batch();
  for (const d of rows) batch.set(db.doc(`masterCriteria/${d.from}`), d);
  await batch.commit();
  console.log(`\n${DATABASE_ID} に書き込みました：masterCriteria ${rows.length} 件`);
}

const rows = JSON.parse(readFileSync(FILE, 'utf8'));
const errors = validate(rows);
if (errors.length) {
  console.error('チェックで問題が見つかったので、書き込みませんでした:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`チェックOK：基準 ${rows.length} 件`);
printSummary(rows);

if (process.argv.includes('--dry-run')) {
  console.log('\n--dry-run なので書き込みはしていません');
} else {
  await write(rows);
}
