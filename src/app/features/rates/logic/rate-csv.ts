// 組合健保の料率の CSV（11/17）
// 1行 ＝ 1つの「何月分から」。健康保険・介護保険・子ども・子育て支援金の 全体・本人・会社
// 組合から届いた何年分かの料率を、まとめて入れる・出す（同じ形で行き来できる）
// Angular・Firebase に依存しない純粋な関数

import type { KumiaiRateInput, MonthRange, RateSplit } from '../../../core/models/rates';
import { isBlankRow } from '../../../shared/csv/csv';
import { toHalfWidth } from '../../../shared/utils/text';
import { inRange } from './rate-changes';
import { formatRateInput, MAX_RATE, parseRate, RateUnit } from './rate-format';

type Kind = 'health' | 'care' | 'childSupport';
type Part = 'total' | 'employee' | 'employer';
const KINDS: readonly Kind[] = ['health', 'care', 'childSupport'];
const PARTS: readonly Part[] = ['total', 'employee', 'employer'];

export type RateCsvColumn = 'from' | 'unit' | `${Kind}_${Part}`;

export const RATE_CSV_HEADERS: Record<RateCsvColumn, string> = {
  from: '何月分から',
  unit: '単位',
  health_total: '健康保険_全体',
  health_employee: '健康保険_本人',
  health_employer: '健康保険_会社',
  care_total: '介護保険_全体',
  care_employee: '介護保険_本人',
  care_employer: '介護保険_会社',
  childSupport_total: '支援金_全体',
  childSupport_employee: '支援金_本人',
  childSupport_employer: '支援金_会社',
};
export const RATE_CSV_COLUMNS = Object.keys(RATE_CSV_HEADERS) as RateCsvColumn[];
const REQUIRED: readonly RateCsvColumn[] = ['from', 'health_employee', 'health_employer'];

/** 見出しの言い換え（記号・空白は無視して比べる） */
const WORDS: Partial<Record<RateCsvColumn, readonly string[]>> = {
  from: ['適用開始月', '何月分', '開始月', '適用月', '改定月'],
  health_total: ['健保_全体', '健康保険料率', '健保料率'],
  health_employee: ['健保_本人', '健康保険_被保険者', '健保_被保険者'],
  health_employer: ['健保_会社', '健康保険_事業主', '健保_事業主'],
  care_total: ['介護_全体', '介護保険料率'],
  care_employee: ['介護_本人', '介護保険_被保険者', '介護_被保険者'],
  care_employer: ['介護_会社', '介護保険_事業主', '介護_事業主'],
  childSupport_total: ['子ども・子育て支援金_全体', '支援金率'],
  childSupport_employee: ['子ども・子育て支援金_本人', '支援金_被保険者'],
  childSupport_employer: ['子ども・子育て支援金_会社', '支援金_事業主'],
};

const keyOf = (s: string) =>
  toHalfWidth(s.replace(/^﻿/, ''))
    .normalize('NFKC')
    .replace(/[\s_・･()（）]/g, '')
    .toLowerCase();

const LOOKUP = new Map<string, RateCsvColumn>();
for (const c of RATE_CSV_COLUMNS) {
  LOOKUP.set(keyOf(RATE_CSV_HEADERS[c]), c);
  for (const w of WORDS[c] ?? []) LOOKUP.set(keyOf(w), c);
}

/** 支援金は2026年4月分から。それより前の行は空なら 0 */
export const CHILD_SUPPORT_START = '2026-04';

export type RateCsvError =
  | 'month' // 何月分からが読めない
  | 'outOfRange' // この組合の期間の外
  | 'duplicate' // ファイルの中で同じ月が2回
  | 'unit' // 単位が % ‰ のどちらでもない
  | `${Kind}.${'format' | 'tooHigh' | 'mismatch' | 'required'}`;

export type RateCsvStatus = 'new' | 'update' | 'same' | 'error';

export interface RateCsvRow {
  line: number; // ファイルの行（見出しが1行目）
  from: string; // 読めた月（読めなければ元の文字）
  input: KumiaiRateInput | null;
  errors: RateCsvError[];
  status: RateCsvStatus;
}

export interface RateCsvResult {
  rows: RateCsvRow[];
  /** 見出しが見つからない必須の列 */
  missing: RateCsvColumn[];
}

/** '2026-04'・'2026/4'・'2026/4/1'・'2026年4月' → '2026-04' */
export function readRateMonth(s: string): string | null {
  const t = toHalfWidth(s).trim();
  const m = /^(\d{4})\s*[-/.年]\s*(\d{1,2})(?:\s*[-/.月]\s*(\d{1,2})?\s*日?)?\s*(?:月|月分|分)?$/.exec(t);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${String(month).padStart(2, '0')}`;
}

function readUnit(s: string): RateUnit | null {
  const t = toHalfWidth(s).trim();
  if (t === '' || t === '%' || t === '％' || t === '百分率' || t.toLowerCase() === 'percent') return 'percent';
  if (t === '‰' || t === '千分率' || t.toLowerCase() === 'permille') return 'permille';
  return null;
}

function sameSplit(a: RateSplit, b: RateSplit): boolean {
  return a.employee === b.employee && a.employer === b.employer;
}

export function sameRate(a: KumiaiRateInput, b: KumiaiRateInput): boolean {
  return KINDS.every((k) => sameSplit(a[k], b[k]));
}

/**
 * 表（見出し ＋ データ）を読む
 * - 全体は空でもよい（本人 ＋ 会社）。入っていれば「全体 ＝ 本人 ＋ 会社」を確かめる
 * - 介護保険は必須。支援金は2026年4月分より前なら空で 0
 * - 単位の列がなければ %
 * - 期間の外の月・ファイルの中で重なる月はエラー。保存済みと同じなら「変わらない」
 */
export function readRateCsv(
  table: readonly (readonly string[])[],
  ctx: { range: MonthRange; existing: readonly KumiaiRateInput[] },
): RateCsvResult {
  const [header = [], ...body] = table;
  const index: Partial<Record<RateCsvColumn, number>> = {};
  header.forEach((h, i) => {
    const c = LOOKUP.get(keyOf(h));
    if (c && index[c] === undefined) index[c] = i;
  });
  const missing = REQUIRED.filter((c) => index[c] === undefined);
  if (missing.length) return { rows: [], missing };

  const existing = new Map(ctx.existing.map((k) => [k.from, k]));
  const seen = new Set<string>();
  const rows: RateCsvRow[] = [];

  body.forEach((cells, i) => {
    if (isBlankRow(cells)) return;
    const line = i + 2;
    const get = (c: RateCsvColumn) => (index[c] === undefined ? '' : (cells[index[c]!] ?? '').trim());
    const errors: RateCsvError[] = [];

    const from = readRateMonth(get('from'));
    if (!from) errors.push('month');
    else if (!inRange(from, ctx.range)) errors.push('outOfRange');
    else if (seen.has(from)) errors.push('duplicate');
    if (from) seen.add(from);

    const unit = readUnit(get('unit'));
    if (!unit) errors.push('unit');

    const splits: Partial<Record<Kind, RateSplit>> = {};
    for (const kind of KINDS) {
      const texts = Object.fromEntries(PARTS.map((p) => [p, get(`${kind}_${p}`)])) as Record<Part, string>;
      const blank = PARTS.every((p) => texts[p] === '');
      if (blank) {
        if (kind === 'childSupport' && from && from < CHILD_SUPPORT_START) splits[kind] = { employee: 0, employer: 0 };
        else errors.push(`${kind}.required`);
        continue;
      }
      if (!unit) continue;
      const employee = parseRate(texts.employee, unit);
      const employer = parseRate(texts.employer, unit);
      const total = texts.total === '' ? null : parseRate(texts.total, unit);
      if (employee === null || employer === null || (texts.total !== '' && total === null)) {
        errors.push(`${kind}.format`);
        continue;
      }
      const sum = employee + employer;
      if (sum > MAX_RATE) {
        errors.push(`${kind}.tooHigh`);
        continue;
      }
      if (total !== null && total !== sum) {
        errors.push(`${kind}.mismatch`);
        continue;
      }
      splits[kind] = { employee, employer };
    }

    if (errors.length || !from || !splits.health || !splits.care || !splits.childSupport) {
      rows.push({ line, from: from ?? get('from'), input: null, errors, status: 'error' });
      return;
    }
    const input: KumiaiRateInput = { from, health: splits.health, care: splits.care, childSupport: splits.childSupport };
    const before = existing.get(from);
    rows.push({
      line,
      from,
      input,
      errors,
      status: !before ? 'new' : sameRate(before, input) ? 'same' : 'update',
    });
  });
  rows.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line);
  return { rows, missing };
}

/** 出力（保存済みの料率。なければ例の1行。取り込みと同じ形） */
export function rateCsvTable(rates: readonly KumiaiRateInput[], unit: RateUnit = 'percent'): string[][] {
  const header = RATE_CSV_COLUMNS.map((c) => RATE_CSV_HEADERS[c]);
  const sign = unit === 'percent' ? '%' : '‰';
  const fmt = (n: number) => formatRateInput(n, unit);
  const row = (k: KumiaiRateInput) => [
    k.from,
    sign,
    ...KINDS.flatMap((kind) => [fmt(k[kind].employee + k[kind].employer), fmt(k[kind].employee), fmt(k[kind].employer)]),
  ];
  const list = [...rates].sort((a, b) => a.from.localeCompare(b.from));
  if (list.length) return [header, ...list.map(row)];
  // 例：健保 9.5%（本人 4.5%・会社 5.0%）、介護 1.8%、支援金 0.23%
  return [
    header,
    row({
      from: '2026-04',
      health: { employee: 45_000, employer: 50_000 },
      care: { employee: 9_000, employer: 9_000 },
      childSupport: { employee: 1_150, employer: 1_150 },
    }),
  ];
}
