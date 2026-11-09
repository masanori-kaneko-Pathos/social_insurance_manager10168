/**
 * 現物給与の価額（seed/master-in-kind.json）を Firestore の masterInKind に書き込む
 *
 * 使い方（プロジェクトのフォルダで）:
 *   node scripts/seed-in-kind.mjs --dry-run   … 中身のチェックと一覧の表示だけ（書き込まない）
 *   node scripts/seed-in-kind.mjs             … チェックが通ったら書き込む
 *
 * 書き込みには、事前に `gcloud auth application-default login` が必要（seed-criteria.mjs と同じ）。
 * 書き写しの間違いを見つけるため、表の中の「つじつま」を確かめる：
 *   - 食事の月額 ＝ 1日の額 × 30
 *   - 朝 ＋ 昼 ＋ 夕 ＝ 1日の額
 */
import { readFileSync } from 'node:fs';

const PROJECT_ID = 'kensyu10168';
const DATABASE_ID = 'socialinsurance-db';
const FILE = new URL('../seed/master-in-kind.json', import.meta.url);
const KEYS = ['from', 'housingUnit', 'prefectures', 'source'];
const CODES = Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, '0'));
const yen = (v) => Number.isSafeInteger(v) && v > 0;

function validate(docs) {
  const errors = [];
  const seen = new Set();
  for (const d of docs) {
    const id = d.from;
    if (Object.keys(d).sort().join() !== [...KEYS].sort().join()) errors.push(`${id}: 項目は ${KEYS.join('・')} だけ`);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(d.from ?? '')) errors.push(`${id}: from は YYYY-MM`);
    if (seen.has(id)) errors.push(`${id}: 重複しています`);
    seen.add(id);
    if (!['tatami', 'sqm'].includes(d.housingUnit)) errors.push(`${id}: housingUnit は tatami か sqm`);
    if (typeof d.source !== 'string' || !d.source) errors.push(`${id}: source（出典）がありません`);
    const codes = Object.keys(d.prefectures ?? {}).sort();
    if (codes.join() !== CODES.join()) errors.push(`${id}: 都道府県は 01〜47 の47件そろえてください`);
    for (const c of codes) {
      const p = d.prefectures[c];
      const m = p.meal ?? {};
      const where = `${id} ${c}${p.name ?? ''}`;
      if (typeof p.name !== 'string' || !p.name) errors.push(`${where}: name がありません`);
      for (const k of ['month', 'day', 'breakfast', 'lunch', 'dinner']) if (!yen(m[k])) errors.push(`${where}: meal.${k} は正の整数`);
      if (!yen(p.housing)) errors.push(`${where}: housing は正の整数`);
      if (m.month !== m.day * 30) errors.push(`${where}: 月額 ${m.month} が 1日 ${m.day} × 30 と合いません`);
      if (m.breakfast + m.lunch + m.dinner !== m.day) errors.push(`${where}: 朝・昼・夕の合計が 1日の額と合いません`);
    }
  }
  return errors;
}

function printSummary(docs) {
  for (const d of [...docs].sort((a, b) => a.from.localeCompare(b.from))) {
    console.log(`\n${d.from}〜（住宅：${d.housingUnit === 'tatami' ? '1畳' : '総面積1㎡'}につき）`);
    for (const c of ['01', '13', '27', '41', '47']) {
      const p = d.prefectures[c];
      console.log(`  ${c} ${p.name}\t食事 月${p.meal.month} 日${p.meal.day}（${p.meal.breakfast}/${p.meal.lunch}/${p.meal.dinner}）\t住宅 ${p.housing}`);
    }
  }
}

async function write(docs) {
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app, DATABASE_ID);
  const batch = db.batch();
  for (const d of docs) batch.set(db.doc(`masterInKind/${d.from}`), d);
  await batch.commit();
  console.log(`\n${DATABASE_ID} に書き込みました：masterInKind ${docs.length} 件`);
}

const docs = JSON.parse(readFileSync(FILE, 'utf8'));
const errors = validate(docs);
if (errors.length) {
  console.error('チェックで問題が見つかったので、書き込みませんでした:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`チェックOK：表 ${docs.length} 件（各47都道府県）`);
printSummary(docs);
if (process.argv.includes('--dry-run')) console.log('\n--dry-run なので書き込みはしていません（上は抜き出し）');
else await write(docs);
