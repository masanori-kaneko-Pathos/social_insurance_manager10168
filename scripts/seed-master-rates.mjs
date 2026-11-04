/**
 * 料率マスタ（seed/master-rates.json）と等級表（seed/master-grades.json）を
 * Firestore の masterRates / masterGrades に書き込む
 *
 * 使い方（プロジェクトのフォルダで）:
 *   node scripts/seed-master-rates.mjs --dry-run   … 中身のチェックと一覧の表示だけ（書き込まない）
 *   node scripts/seed-master-rates.mjs             … チェックが通ったら書き込む
 *
 * 書き込みには、事前に `gcloud auth application-default login` が必要。
 * アプリからは masterRates / masterGrades に書けない（ルールで禁止）ので、書けるのはこのスクリプトだけ。
 */
import { readFileSync } from 'node:fs';

const PROJECT_ID = 'kensyu10168';
const DATABASE_ID = 'socialinsurance-db';
const FILE = new URL('../seed/master-rates.json', import.meta.url);
const GRADES_FILE = new URL('../seed/master-grades.json', import.meta.url);

const PREF_NAMES = ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島', '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川', '新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知', '三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山', '鳥取', '島根', '岡山', '広島', '山口', '徳島', '香川', '愛媛', '高知', '福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'];
const PREF_CODES = PREF_NAMES.map((_, i) => String(i + 1).padStart(2, '0'));
const NATIONAL_KINDS = ['care', 'childSupport', 'pension', 'childContribution'];

const pct = (micro) => `${Math.floor(micro / 10000)}.${String(micro % 10000).padStart(4, '0')}%`;

// ===== 1. 中身のチェック（1つでも問題があれば書き込まない） =====
function validate(docs) {
  const errors = [];
  const ids = new Set();
  const isRate = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;

  for (const d of docs) {
    const id = `${d.kind}_${d.from}`;
    if (ids.has(id)) errors.push(`${id}: 重複しています`);
    ids.add(id);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(d.from)) errors.push(`${id}: from は YYYY-MM で書いてください`);
    if (typeof d.source !== 'string' || !d.source) errors.push(`${id}: source（出典）がありません`);

    if (d.kind === 'kyokaiHealth') {
      const keys = Object.keys(d.byPrefecture ?? {}).sort();
      if (keys.join() !== PREF_CODES.join()) errors.push(`${id}: 都道府県が47そろっていません`);
      for (const [code, v] of Object.entries(d.byPrefecture ?? {})) {
        // 健保の料率は 5〜15% の範囲のはず。折半するので偶数であること
        if (!isRate(v, 50000, 150000) || v % 2 !== 0) errors.push(`${id}: ${code} の値がおかしい（${v}）`);
      }
    } else if (NATIONAL_KINDS.includes(d.kind)) {
      if (!isRate(d.rate, 0, 300000)) errors.push(`${id}: rate の値がおかしい（${d.rate}）`);
      // 拠出金は会社だけの負担なので折半しない。それ以外は偶数であること
      if (d.kind !== 'childContribution' && d.rate % 2 !== 0) errors.push(`${id}: 折半できない値（${d.rate}）`);
    } else {
      errors.push(`${id}: kind が不明です`);
    }
  }
  return errors;
}

// 等級表のチェック：等級が1からの連番、下限は0から始まって増えていく、標準報酬月額も増えていく
function validateGrades(tables) {
  const errors = [];
  const ids = new Set();
  for (const t of tables) {
    const id = `${t.kind}_${t.from}`;
    if (ids.has(id)) errors.push(`${id}: 重複しています`);
    ids.add(id);
    if (!['health', 'pension'].includes(t.kind)) errors.push(`${id}: kind が不明です`);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(t.from)) errors.push(`${id}: from は YYYY-MM で書いてください`);
    if (typeof t.source !== 'string' || !t.source) errors.push(`${id}: source（出典）がありません`);
    const g = t.grades ?? [];
    if (g.length === 0) errors.push(`${id}: 等級がありません`);
    g.forEach((row, i) => {
      if (row.grade !== i + 1) errors.push(`${id}: ${i + 1}番目の等級が ${row.grade} になっています`);
      if (![row.standard, row.min].every(Number.isSafeInteger)) errors.push(`${id}: ${row.grade}級の金額が整数ではありません`);
      if (i === 0 && row.min !== 0) errors.push(`${id}: 1級の下限は0にしてください`);
      if (i > 0 && !(row.min > g[i - 1].min && row.standard > g[i - 1].standard)) {
        errors.push(`${id}: ${row.grade}級が前の等級より大きくなっていません`);
      }
    });
  }
  return errors;
}

// ===== 2. 人が目で確かめるための一覧 =====
function printSummary(docs) {
  const kyokai = docs.filter((d) => d.kind === 'kyokaiHealth').sort((a, b) => a.from.localeCompare(b.from));
  console.log('\n協会けんぽ 健康保険料率（都道府県別）');
  console.log(['都道府県', ...kyokai.map((d) => `${d.from}〜`)].join('\t'));
  PREF_CODES.forEach((code, i) => {
    console.log([`${code} ${PREF_NAMES[i]}`, ...kyokai.map((d) => pct(d.byPrefecture[code]))].join('\t'));
  });
  console.log('\n全国一律');
  for (const d of docs.filter((x) => x.kind !== 'kyokaiHealth')) {
    console.log(`${d.kind}\t${d.from}〜\t${pct(d.rate)}`);
  }
}

// ===== 3. 書き込み =====
function printGrades(tables) {
  for (const t of tables) {
    const g = t.grades;
    console.log(`\n等級表 ${t.kind} ${t.from}〜：${g.length}等級（${g[0].standard.toLocaleString()}円〜${g[g.length - 1].standard.toLocaleString()}円）`);
  }
}

async function write(docs, grades) {
  // firebase-admin は書き込むときだけ読み込む（--dry-run なら入っていなくても動く）
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore(app, DATABASE_ID);

  const batch = db.batch();
  for (const d of docs) batch.set(db.doc(`masterRates/${d.kind}_${d.from}`), d);
  for (const t of grades) batch.set(db.doc(`masterGrades/${t.kind}_${t.from}`), t);
  await batch.commit();
  console.log(`\n${DATABASE_ID} に書き込みました：masterRates ${docs.length} 件、masterGrades ${grades.length} 件`);
}

const docs = JSON.parse(readFileSync(FILE, 'utf8'));
const grades = JSON.parse(readFileSync(GRADES_FILE, 'utf8'));
const errors = [...validate(docs), ...validateGrades(grades)];
if (errors.length) {
  console.error('チェックで問題が見つかったので、書き込みませんでした:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`チェックOK：料率 ${docs.length} 件、等級表 ${grades.length} 件`);
printSummary(docs);
printGrades(grades);

if (process.argv.includes('--dry-run')) {
  console.log('\n--dry-run なので書き込みはしていません');
} else {
  await write(docs, grades);
}