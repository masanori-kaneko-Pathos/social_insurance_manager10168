// 表（文字の2次元配列）→ xlsx のセル（数字は数値のセルに。先頭が0の番号は文字のまま）
// Angular・Firebase に依存しない純粋な関数（書き出しの本体は download-xlsx.ts）

export type XlsxCell = { t: 's'; v: string } | { t: 'n'; v: number; z?: string };

const NUM = /^-?\d+(\.\d+)?$/;

/** 社員番号・郵便番号のように、先頭が0の数字は文字のまま（'0012' を 12 にしない） */
export function toCell(s: string): XlsxCell {
  const t = s.trim();
  if (NUM.test(t) && !/^-?0\d/.test(t)) {
    const v = Number(t);
    // 金額らしいもの（1000以上の整数・小数）は桁区切りの表示に
    return Math.abs(v) >= 1000 || !Number.isInteger(v) ? { t: 'n', v, z: Number.isInteger(v) ? '#,##0' : '#,##0.###' } : { t: 'n', v };
  }
  return { t: 's', v: s };
}

/** 列の幅（文字数のいちばん長いところ。全角は2つ分。8〜40の間） */
export function columnWidths(rows: readonly (readonly string[])[]): number[] {
  const widths: number[] = [];
  for (const r of rows) {
    r.forEach((s, i) => {
      const w = [...(s ?? '')].reduce((n, ch) => n + (/[ -~]/.test(ch) ? 1 : 2), 0);
      widths[i] = Math.max(widths[i] ?? 0, w);
    });
  }
  return widths.map((w) => Math.min(Math.max(w + 2, 8), 40));
}
