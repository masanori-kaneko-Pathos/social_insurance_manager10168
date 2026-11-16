// 取り込みのエラーの直し方（従業員・扶養家族・給与の実績で共通。11/16）
// Angular・Firebase に依存しない純粋な関数
// - 画面で直した値（'行|列' → 値）を、読んだ表に入れ直す（表にない列なら右に足す）
// - エラーの行だけを、元の列 ＋ 右端に「エラー」の列で書き出す（Excel で直して、そのファイルを取り込み直す）
// - エラーのコード → 直す欄（列）を決める
//
// 行の番号は、見出しを1行目と数えた表の行（ファイルの行番号と同じ）

import { headerKey } from './column-map';

/** 画面で直した値の鍵 */
export function cellKey(line: number, column: string): string {
  return `${line}|${column}`;
}

/**
 * 直した値を表に入れる（元の表は変えず、新しい表を返す）
 * labelsOf(列) は、その列として受け付ける見出し（日本語・英語など）。最初のものを、足すときの見出しに使う
 */
export function applyCellEdits(
  table: readonly (readonly string[])[],
  edits: ReadonlyMap<string, string>,
  labelsOf: (column: string) => readonly string[],
): string[][] {
  const out = table.map((row) => [...row]);
  if (out.length === 0) return out;
  const header = out[0];
  for (const [k, value] of edits) {
    const sep = k.indexOf('|');
    const line = Number(k.slice(0, sep));
    const column = k.slice(sep + 1);
    const row = out[line - 1];
    if (!row || line < 2) continue;
    const labels = labelsOf(column);
    const keys = new Set(labels.map(headerKey));
    let j = header.findIndex((h) => keys.has(headerKey(h)));
    if (j < 0) {
      header.push(labels[0] ?? column);
      j = header.length - 1;
    }
    while (row.length <= j) row.push('');
    row[j] = value;
  }
  return out;
}

/** エラーの行だけの表（元の見出し ＋ エラーの列）。messages は 行 → 文 */
export function errorRowsTable(
  table: readonly (readonly string[])[],
  messages: ReadonlyMap<number, string>,
  errorHeader: string,
): string[][] {
  const head = [...(table[0] ?? []), errorHeader];
  const width = (table[0] ?? []).length;
  const rows = [...messages.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, msg]) => {
      const row = [...(table[line - 1] ?? [])];
      while (row.length < width) row.push('');
      return [...row, msg];
    });
  return [head, ...rows];
}

/** エラーのコード → 直す欄（重ならないよう、出てきた順に1回ずつ） */
export function columnsForCodes(
  codes: readonly string[],
  map: Readonly<Record<string, readonly string[]>>,
): string[] {
  const out: string[] = [];
  for (const c of codes) for (const col of map[c] ?? []) if (!out.includes(col)) out.push(col);
  return out;
}

/** その列の今の値（表から） */
export function cellOf(
  table: readonly (readonly string[])[],
  line: number,
  labels: readonly string[],
): string {
  const keys = new Set(labels.map(headerKey));
  const j = (table[0] ?? []).findIndex((h) => keys.has(headerKey(h)));
  return j < 0 ? '' : (table[line - 1]?.[j] ?? '');
}
