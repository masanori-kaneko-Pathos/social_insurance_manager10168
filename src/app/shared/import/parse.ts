// 取り込むファイルを、表（行 × 列の文字。1行目は見出し）にする
// CSV・TSV・Excel（xlsx・xls）・PDF。課題管理アプリの parse.ts から移植
// SheetJS と pdf.js は大きいので、そのファイルを選んだときに初めて読み込む（最初の読み込みを増やさない）

import { CsvEncoding, decodeCsv, isBlankRow, parseCsv } from '../csv/csv';
import { excelSerialToDate } from './column-map';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** 取り込みの失敗（code は翻訳キー importMap.error.〇〇） */
export class ImportFileError extends Error {
  constructor(readonly code: 'tooBig' | 'badType' | 'empty' | 'noText' | 'tooManyPages') {
    super(code);
  }
}

/** 読んだ表。CSV・PDF は1つ、Excel はシートの数だけ（見出しだけ・空のシートは除く）。pdf ＝ 読み取りの確認が要る */
export interface SheetTable {
  name: string;
  rows: string[][];
  pdf?: boolean;
}

export interface ReadFile {
  tables: SheetTable[];
  /** CSV・TSV のときだけ（どの文字コードで読めたか） */
  encoding: CsvEncoding | null;
}

/** 選べるファイルの形（input の accept に使う） */
export const IMPORT_ACCEPT = '.csv,.tsv,.txt,.xlsx,.xls,.pdf,text/csv';

export async function readTables(file: File): Promise<ReadFile> {
  if (file.size > MAX_FILE_BYTES) throw new ImportFileError('tooBig');
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  let tables: SheetTable[];
  let encoding: CsvEncoding | null = null;
  if (['csv', 'tsv', 'txt'].includes(ext)) {
    const decoded = decodeCsv(await file.arrayBuffer());
    encoding = decoded.encoding;
    const sep = ext === 'tsv' || looksTabbed(decoded.text) ? '\t' : ',';
    tables = [{ name: file.name, rows: parseCsv(decoded.text, sep) }];
  } else if (ext === 'xlsx' || ext === 'xls') {
    tables = await readExcel(await file.arrayBuffer());
  } else if (ext === 'pdf') {
    const { readPdf } = await import('./pdf');
    tables = [{ name: file.name, rows: await readPdf(await file.arrayBuffer()), pdf: true }];
  } else {
    throw new ImportFileError('badType');
  }
  tables = tables.map((t) => ({ ...t, rows: tidy(t.rows) })).filter((t) => t.rows.length >= 2);
  if (!tables.length) throw new ImportFileError('empty');
  return { tables, encoding };
}

/** 1行目にカンマがなく、タブがあれば、タブ区切りとみなす */
export function looksTabbed(text: string): boolean {
  const first = text.split(/\r\n|\n|\r/, 1)[0] ?? '';
  return first.includes('\t') && !first.includes(',');
}

/** 空の行（Excel が末尾に足しがち）を除き、列の数をそろえる。CSV と Excel で同じ形にする */
export function tidy(rows: readonly (readonly string[])[]): string[][] {
  const filled = rows.filter((r) => !isBlankRow(r));
  const width = Math.max(0, ...filled.map((r) => r.length));
  return filled.map((r) => [...r, ...Array<string>(width - r.length).fill('')]);
}

// ===== Excel =====

/** SheetJS のセル（使うところだけ） */
export interface ExcelCell {
  t: string; // 'n' 数・'s' 文字・'b' 真偽・'d' 日付・'e' エラー・'z' 空
  v?: unknown;
  z?: string; // 表示形式（'yyyy/m/d'・'[h]:mm' など）
}

/** 表示形式に「日付の部分」（年・日）があるか。"..." と [...] の中は見ない */
function hasDatePart(fmt: string): boolean {
  return /[yde]/i.test(fmt.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, ''));
}

/**
 * セル → 文字
 * - 日付の形式の数：日付なら 'YYYY-MM-DD'、時刻・経過時間なら 'H:MM'（40:00 は Excel では 1.666… 日）
 * - それ以外の数：表示の形ではなく、数そのもの（「300,000」ではなく「300000」）
 * 表示どおりの文字にしないのは、書式によって 10/20/26 のような読み違えやすい形になるため
 */
export function excelCellText(cell: ExcelCell | undefined, isDateFormat: (fmt: string) => boolean): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.t === 'e') return '';
  if (cell.t === 'd' && cell.v instanceof Date) return cell.v.toISOString().slice(0, 10);
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  if (cell.t === 'n' && typeof cell.v === 'number') {
    if (cell.z && isDateFormat(cell.z)) {
      if (hasDatePart(cell.z)) return excelSerialToDate(cell.v);
      const minutes = Math.round(cell.v * 24 * 60);
      return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
    }
    return String(cell.v);
  }
  return String(cell.v);
}

async function readExcel(buf: ArrayBuffer): Promise<SheetTable[]> {
  const XLSX = await import('xlsx');
  // cellNF：セルの表示形式（日付・時刻か）を見るため
  const wb = XLSX.read(buf, { type: 'array', cellNF: true });
  const isDate = (fmt: string) => XLSX.SSF.is_date(fmt);
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = ws['!ref'];
    if (!ref) return { name, rows: [] };
    const range = XLSX.utils.decode_range(ref);
    const rows: string[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        row.push(excelCellText(ws[XLSX.utils.encode_cell({ r, c })] as ExcelCell | undefined, isDate));
      }
      rows.push(row);
    }
    return { name, rows };
  });
}
