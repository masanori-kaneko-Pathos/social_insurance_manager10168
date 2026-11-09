/**
 * 社会保障協定（seed/master-agreements.json）を Firestore の masterAgreements に書き込む
 *
 * 使い方（プロジェクトのフォルダで）:
 *   node scripts/seed-agreements.mjs --dry-run   … 中身のチェックと一覧の表示だけ（書き込まない）
 *   node scripts/seed-agreements.mjs             … チェックが通ったら書き込む
 *
 * 書き込みには、事前に `gcloud auth application-default login` が必要（seed-criteria.mjs と同じ）。
 * 表にない国の古いドキュメントは消さない（消すときは Firebase コンソールで）。
 */
import { readFileSync } from 'node:fs';

const PROJECT_ID = 'kensyu10168';
const DATABASE_ID = 'socialinsurance-db';
const FILE = new URL('../seed/master-agreements.json', import.meta.url);
const KEYS = ['country', 'name', 'from', 'covers', 'totalization', 'note', 'source'];

function validate(rows) {
  const errors = [];
  const seen = new Set();
  for (const d of rows) {
    const id = d.country;
    if (Object.keys(d).sort().join() !== [...KEYS].sort().join()) errors.push(`${id}: 項目は ${KEYS.join('・')} だけにしてください`);
    if (!/^[A-Z]{2}$/.test(d.country ?? '')) errors.push(`${id}: country は大文字2文字（ISO 3166-1）`);
    if (seen.has(id)) errors.push(`${id}: 重複しています`);
    seen.add(id);
    if (typeof d.name !== 'string' || !d.name) errors.push(`${id}: name がありません`);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(d.from ?? '')) errors.push(`${id}: from は YYYY-MM`);
    if (!['pension', 'pensionAndHealth'].includes(d.covers)) errors.push(`${id}: covers は pension か pensionAndHealth`);
    if (typeof d.totalization !== 'boolean') errors.push(`${id}: totalization は true/false`);
    if (!(d.note === null || (typeof d.note === 'string' && d.note.length <= 300))) errors.push(`${id}: note は300字までか null`);
    if (typeof d.source !== 'string' || !d.source) errors.push(`${id}: source（出典）がありません`);
  }
  return errors;
}

function printSummary(rows) {
  console.log('\n社会保障協定（masterAgreements）');
  console.log(['国', '発効', '日本で免除', '通算'].join('\t'));
  for (const d of [...rows].sort((a, b) => a.from.localeCompare(b.from))) {
    console.log([`${d.country} ${d.name}`, d.from, d.covers === 'pension' ? '年金' : '年金・医療', d.totalization ? '○' : '×'].join('\t'));
  }
}

async function write(rows) {
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app, DATABASE_ID);
  const batch = db.batch();
  for (const d of rows) batch.set(db.doc(`masterAgreements/${d.country}`), d);
  await batch.commit();
  console.log(`\n${DATABASE_ID} に書き込みました：masterAgreements ${rows.length} 件`);
}

const rows = JSON.parse(readFileSync(FILE, 'utf8'));
const errors = validate(rows);
if (errors.length) {
  console.error('チェックで問題が見つかったので、書き込みませんでした:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`チェックOK：協定 ${rows.length} か国`);
printSummary(rows);
if (process.argv.includes('--dry-run')) console.log('\n--dry-run なので書き込みはしていません');
else await write(rows);
