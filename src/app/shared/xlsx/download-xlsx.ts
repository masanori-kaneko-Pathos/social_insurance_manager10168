import { columnWidths, toCell } from './xlsx-out';

/**
 * 表を xlsx にしてダウンロードする（SheetJS。使うときだけ読み込む）
 * rows は CSV と同じ形（1行目が見出し）。数字は数値のセルにして、Excel でそのまま足し算できるように
 */
export async function downloadXlsx(fileName: string, sheetName: string, rows: readonly (readonly string[])[]): Promise<void> {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((s) => toCell(s ?? ''))));
  ws['!cols'] = columnWidths(rows).map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // シート名は31文字まで
  XLSX.writeFile(wb, fileName);
}
