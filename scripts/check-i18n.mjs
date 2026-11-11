// 翻訳ファイルのキーがそろっているか確かめる（node scripts/check-i18n.mjs）
// - public/i18n/ja.json を基準に、ほかの言語の「抜け（訳がない）」と「余り（ja にない）」を出す
// - src/app/core/i18n/languages.ts の一覧にある言語のファイルがあるかも確かめる
// - 中身が空の訳（""）は、知らせるだけ（英語では付けない「〜月」などがあるので、失敗にはしない）
// そろっていれば 0、そろっていなければ 1 で終わる（コミットの前やビルドの前に動かせる）

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public', 'i18n');
const BASE = 'ja';

/** { a: { b: 'x' } } → Map { 'a.b' => 'x' } */
function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

function load(lang) {
  return flatten(JSON.parse(readFileSync(join(dir, `${lang}.json`), 'utf8')));
}

// languages.ts の LANGUAGES = [ … ] の中の code: '..' を拾う（TypeScript を読み込まずに済むよう、文字で探す。説明のコメントの例は拾わない）
const src = readFileSync(join(root, 'src/app/core/i18n/languages.ts'), 'utf8');
const list = src.slice(src.indexOf('LANGUAGES = ['), src.indexOf('] as const'));
const listed = [...list.matchAll(/code:\s*'([a-zA-Z-]+)'/g)].map((m) => m[1]);
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

let problems = 0;
const base = load(BASE);
console.log(`基準：${BASE}.json（${base.size} キー）`);

for (const lang of listed) {
  if (!existsSync(join(dir, `${lang}.json`))) {
    console.log(`\n✗ ${lang}：languages.ts にあるのに public/i18n/${lang}.json がありません`);
    problems++;
  }
}
for (const lang of files) {
  if (!listed.includes(lang)) console.log(`\n△ ${lang}.json は languages.ts の一覧にありません（切り替えに出ません）`);
}

for (const lang of files.filter((l) => l !== BASE)) {
  const other = load(lang);
  const missing = [...base.keys()].filter((k) => !other.has(k));
  const extra = [...other.keys()].filter((k) => !base.has(k));
  const empty = [...other.entries()].filter(([k, v]) => v === '' && base.get(k) !== '').map(([k]) => k);
  if (missing.length + extra.length === 0) {
    console.log(`\n✓ ${lang}：そろっています（${other.size} キー）`);
  } else {
    problems++;
    console.log(`\n✗ ${lang}：抜け ${missing.length}・余り ${extra.length}`);
    for (const k of missing) console.log(`  抜け  ${k}`);
    for (const k of extra) console.log(`  余り  ${k}`);
  }
  for (const k of empty) console.log(`  △ 空の訳  ${k}（わざとなら、そのままで構いません）`);
}

process.exit(problems === 0 ? 0 : 1);
