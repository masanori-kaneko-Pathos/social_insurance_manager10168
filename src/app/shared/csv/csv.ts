// CSV の共通部品（Angular・Firebase に依存しない）
// - ファイルの中身（バイト列）→ 文字（UTF-8 か Shift_JIS かを自動で判定）
// - 文字 → 行と列（"" で囲んだ値・値の中の改行・"" の二重を扱う）
// - 行と列 → 文字（Excel で開けるよう、BOM と CRLF をつける）

export type CsvEncoding = 'utf-8' | 'shift_jis';

/**
 * バイト列を文字にする。UTF-8 として読めなければ Shift_JIS として読む
 * （Excel で「CSV（コンマ区切り）」保存したファイルは Shift_JIS のことが多い）
 */
export function decodeCsv(bytes: ArrayBuffer | Uint8Array): { text: string; encoding: CsvEncoding } {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    return { text: stripBom(text), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('shift_jis').decode(data), encoding: 'shift_jis' };
  }
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** CSV の文字 → 行の配列（1行 ＝ 列の配列）。最後の空行は捨てる。sep はタブ区切り（TSV）のときに '\t' */
export function parseCsv(input: string, sep = ','): string[][] {
  const s = stripBom(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"' && cell === '') {
      quoted = true;
      i++;
    } else if (c === sep) {
      row.push(cell);
      cell = '';
      i++;
    } else if (c === '\r' || c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += c === '\r' && s[i + 1] === '\n' ? 2 : 1;
    } else {
      cell += c;
      i++;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** 全部の列が空の行か */
export function isBlankRow(row: readonly string[]): boolean {
  return row.every((c) => c.trim() === '');
}

function quote(v: string): string {
  return /[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 行の配列 → CSV の文字（CRLF 区切り。BOM は downloadCsv でつける） */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n';
}

/** ブラウザでダウンロードさせる（BOM つき UTF-8。Excel でそのまま開ける） */
export function downloadCsv(fileName: string, rows: readonly (readonly string[])[]): void {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** ファイル名に使えない文字を置き換える */
export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_');
}
