// 年月（YYYY-MM）を画面の言葉にする（11/27。「2024-11」のような生の年月を出さない）
// 形は翻訳の format.yearMonth（ja：{{y}}年{{m}}月、en：{{mon}} {{y}}）。Angular に依存しない純粋な関数

/** 年月だけの文字（1900〜2199年・01〜12月）。日付（YYYY-MM-DD）や社員番号・電話番号は当たらない */
export const YEAR_MONTH_RE = /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 年月を形に当てはめる（年月でなければそのまま返す） */
export function yearMonthText(value: string, template: string): string {
  if (!YEAR_MONTH_RE.test(value)) return value;
  const [y, mm] = value.split('-');
  const m = Number(mm);
  return template
    .replace(/\{\{\s*y\s*\}\}/g, y)
    .replace(/\{\{\s*mm\s*\}\}/g, mm)
    .replace(/\{\{\s*mon\s*\}\}/g, MON[m - 1])
    .replace(/\{\{\s*m\s*\}\}/g, String(m));
}

/** 翻訳の引数のうち、年月だけの値を言葉にする（ほかの値・入れ子はそのまま） */
export function yearMonthParams(params: Record<string, unknown>, template: string): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' && YEAR_MONTH_RE.test(v)) {
      out ??= { ...params };
      out[k] = yearMonthText(v, template);
    }
  }
  return out ?? params;
}
