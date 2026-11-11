// よそのファイル（給与ソフト・労務ソフトの書き出し、Excel、PDF）を「うちの CSV の形」に言い直す通訳
// Angular・Firebase に依存しない純粋な関数
//
// 流れ
// 1. guessMapping：ファイルの見出しを、言い換えの表でうちの項目に結ぶ
// 2. 人が「列を合わせる」画面で直す（ファイルの列から／全員に同じ値／使わない）
// 3. toOurTable：値を言い直して、見出しがうちの名前の表を作る → 今までの読み取り（readEmployeeCsv など）へ
//
// 読めない値は消さずに、元の文字のまま渡す（今の確認画面が「行・列・値」つきでエラーを出すため）

import { toHalfWidth, toKatakana } from '../utils/text';

// ===== 項目の定義 =====

/** 値の言い直し方 */
export type ValueKind =
  | 'text' // そのまま（前後の空白だけ取る）
  | 'date' // 'YYYY-MM-DD' に（和暦・Excel の日付の数・YYYYMMDD・年月日）
  | 'month' // 'YYYY-MM' に
  | 'kana' // 全角カタカナに（半角カナ・ひらがなを直す）
  | 'digits' // 番号：ハイフン・空白を取る
  | 'number' // 金額・日数：「円」「日」「,」を取る
  | 'days'; // 日数：小数は切り捨て（「一ヶ月の平均所定労働日数 20.5」など）

export interface ImportField<K extends string = string> {
  key: K;
  /** うちの見出し（画面にも出す） */
  header: string;
  /** よその見出しの言い方（言い換えの表） */
  words: readonly string[];
  kind?: ValueKind;
  required?: boolean;
  /** 必須でも、この項目がすべて結ばれていれば足りる（例：週の時間 ← 1日の分 × 週の日数） */
  orFrom?: readonly K[];
}

/** うちの項目ごとの「どこから取るか」。null ＝ 使わない */
export type Source = { col: number } | { fixed: string } | null;
export type Mapping<K extends string = string> = Partial<Record<K, Source>>;

// ===== 見出しを当てる =====

/** 比べるためにそろえる（全角半角・大文字小文字・空白・よくある記号を無視） */
export function headerKey(s: string): string {
  return s
    .replace(/^﻿/, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_\-・:()［］[\]#＃（）「」]/g, '');
}

/** ファイルの見出しから、うちの項目ごとの列を当てる。1つの列は1つの項目にだけ。同じ項目に2列当たったら先の列 */
export function guessMapping<K extends string>(
  headers: readonly string[],
  fields: readonly ImportField<K>[],
): Mapping<K> {
  const lookup = new Map<string, K>();
  for (const f of fields) {
    for (const w of [f.header, f.key, ...f.words]) {
      const k = headerKey(w);
      if (k && !lookup.has(k)) lookup.set(k, f.key);
    }
  }
  const out: Mapping<K> = {};
  headers.forEach((h, i) => {
    const key = lookup.get(headerKey(h));
    if (key && out[key] === undefined) out[key] = { col: i };
  });
  return out;
}

/** うちの見出しそのままのファイルか（必須が全部、うちの見出しの名前で見つかる） */
export function isOurFormat<K extends string>(
  headers: readonly string[],
  fields: readonly ImportField<K>[],
  ourNames: (f: ImportField<K>) => readonly string[] = (f) => [f.header, f.key],
): boolean {
  const keys = new Set(headers.map(headerKey));
  return fields
    .filter((f) => f.required)
    .every((f) => ourNames(f).some((n) => keys.has(headerKey(n))));
}

const bound = (s: Source | undefined) =>
  !!s && ('col' in s ? true : s.fixed.trim() !== '');

/** 結ばれていない必須の項目 */
export function missingRequired<K extends string>(
  fields: readonly ImportField<K>[],
  mapping: Mapping<K>,
): K[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => !bound(mapping[f.key]) && !(f.orFrom?.length && f.orFrom.every((k) => bound(mapping[k]))))
    .map((f) => f.key);
}

/** どの項目にも使っていないファイルの列 */
export function unusedColumns(headers: readonly string[], mapping: Mapping): number[] {
  const used = new Set(
    Object.values(mapping)
      .filter((s): s is { col: number } => !!s && 'col' in s)
      .map((s) => s.col),
  );
  return headers.map((_, i) => i).filter((i) => !used.has(i) && headers[i].trim() !== '');
}

// ===== 値の言い直し =====

const ERA: Record<string, number> = {
  令和: 2018, r: 2018, 平成: 1988, h: 1988, 昭和: 1925, s: 1925, 大正: 1911, t: 1911,
};

/** 年・月・日が実在する日か（2/30 は ×） */
function realDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const s = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${s}T00:00:00Z`);
  return !isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === s ? s : null;
}

/** Excel の日付の数（1900年方式。1 ＝ 1900-01-01、60 は存在しない 2/29）→ 'YYYY-MM-DD' */
export function excelSerialToDate(n: number): string {
  // 25569 ＝ 1970-01-01。1900-03-01 より後は、この引き算で合う
  const ms = Math.round((Math.floor(n) - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

/** 年・月・日（日は無くてもよい）を読む。読めなければ null */
function readYmd(raw: string): { y: number; m: number; d: number | null } | null {
  // 後ろの時刻（「2026/10/1 0:00」）を先に落としてから、空白を取る
  const s = toHalfWidth(raw)
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\st]+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?z?$/, '')
    .replace(/\s+/g, '');
  if (s === '') return null;
  // Excel の日付の数（CSV に数のまま出たもの）
  let m = /^(\d{5})(?:\.\d+)?$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (n > 60 && n < 2958466) {
      const [y, mo, d] = excelSerialToDate(n).split('-').map(Number);
      return { y, m: mo, d };
    }
  }
  // 20260401・202604
  m = /^(\d{4})(\d{2})(\d{2})?$/.exec(s);
  if (m) return { y: +m[1], m: +m[2], d: m[3] ? +m[3] : null };
  // 2026-04-01・2026/4/1・2026.4.1・2026年4月1日（後ろの時刻は無視）
  m = /^(\d{4})[-/.年](\d{1,2})月?(?:[-/.](\d{1,2})日?|(\d{1,2})日)?$/.exec(s);
  if (m) return { y: +m[1], m: +m[2], d: m[3] ? +m[3] : m[4] ? +m[4] : null };
  // 和暦：令和8年4月1日・R8.4.1・H31/4/30・令和元年5月1日
  m = /^(令和|平成|昭和|大正|r|h|s|t)(元|\d{1,2})[年./-](\d{1,2})月?(?:[./-](\d{1,2})日?|(\d{1,2})日)?$/.exec(s);
  if (m) {
    const y = ERA[m[1]] + (m[2] === '元' ? 1 : +m[2]);
    return { y, m: +m[3], d: m[4] ? +m[4] : m[5] ? +m[5] : null };
  }
  return null;
}

/** 日付を 'YYYY-MM-DD' に。読めなければ元の文字のまま */
export function normalizeDate(raw: string): string {
  const t = raw.trim();
  const p = readYmd(t);
  if (!p || p.d === null) return t;
  return realDate(p.y, p.m, p.d) ?? t;
}

/** 年月を 'YYYY-MM' に（日があっても月までにする）。読めなければ元の文字のまま */
export function normalizeMonth(raw: string): string {
  const t = raw.trim();
  const p = readYmd(t);
  if (!p || p.m < 1 || p.m > 12) return t;
  if (p.d !== null && !realDate(p.y, p.m, p.d)) return t;
  return `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}`;
}

/** 半角カナ・ひらがなを全角カタカナに（ｶﾞ → ガ） */
export function normalizeKana(raw: string): string {
  return toKatakana(raw.normalize('NFKC')).trim();
}

/** 番号：全角を半角にして、ハイフン・空白を取る */
export function normalizeDigits(raw: string): string {
  return toHalfWidth(raw).replace(/[-‐ー－−\s]/g, '').trim();
}

/** 金額・日数：「円」「¥」「日」「,」を取る */
export function normalizeNumber(raw: string): string {
  return toHalfWidth(raw).replace(/[円¥￥日,\s]/g, '').trim();
}

/** 日数：数にして、小数は切り捨て */
export function normalizeDays(raw: string): string {
  const t = normalizeNumber(raw);
  return /^\d+\.\d+$/.test(t) ? String(Math.floor(Number(t))) : t;
}

export function normalizeValue(kind: ValueKind | undefined, raw: string): string {
  switch (kind) {
    case 'date': return normalizeDate(raw);
    case 'month': return normalizeMonth(raw);
    case 'kana': return normalizeKana(raw);
    case 'digits': return normalizeDigits(raw);
    case 'number': return normalizeNumber(raw);
    case 'days': return normalizeDays(raw);
    default: return raw.trim();
  }
}

/** 「山田 太郎」「山田　太郎」→ ['山田', '太郎']。空白がなければ全部を姓に */
export function splitName(raw: string): [string, string] {
  const t = raw.trim();
  const m = /^(\S+)[\s　]+(.+)$/.exec(t);
  return m ? [m[1], m[2].trim()] : [t, ''];
}

// ===== うちの表を作る =====

/** 1行ぶんの値（うちの項目 → 言い直した文字） */
export type RowValues<K extends string> = Partial<Record<K, string>>;

export interface OurTableSpec<K extends string, O extends K> {
  fields: readonly ImportField<K>[];
  /** うちの表に出す列（並び順）と、その見出し */
  out: readonly O[];
  outHeader: (k: O) => string;
  /** 項目どうしの計算（氏名を分ける・1日の分から週の時間 など）。空の項目だけを埋める */
  finish?: (v: RowValues<K>) => RowValues<K>;
}

/** 1行を言い直す（finish まで） */
export function convertRow<K extends string, O extends K>(
  cells: readonly string[],
  mapping: Mapping<K>,
  spec: OurTableSpec<K, O>,
): RowValues<K> {
  const v: RowValues<K> = {};
  for (const f of spec.fields) {
    const s = mapping[f.key];
    if (!s) continue;
    const raw = 'col' in s ? (cells[s.col] ?? '') : s.fixed;
    v[f.key] = normalizeValue(f.kind, raw);
  }
  return spec.finish ? spec.finish(v) : v;
}

/** ファイルの表（1行目は見出し）→ 見出しがうちの名前の表 */
export function toOurTable<K extends string, O extends K>(
  table: readonly (readonly string[])[],
  mapping: Mapping<K>,
  spec: OurTableSpec<K, O>,
): string[][] {
  const [, ...body] = table;
  const header = spec.out.map(spec.outHeader);
  const rows = body
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((cells) => {
      const v = convertRow(cells, mapping, spec);
      return spec.out.map((k) => v[k] ?? '');
    });
  return [header, ...rows];
}
