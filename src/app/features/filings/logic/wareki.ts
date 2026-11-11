// 和暦（届書の日付の欄に書き写すため）
// Angular・Firebase に依存しない純粋な関数

const ERAS = [
  { name: '令和', start: '2019-05-01' },
  { name: '平成', start: '1989-01-08' },
  { name: '昭和', start: '1926-12-25' },
  { name: '大正', start: '1912-07-30' },
] as const;

function eraOf(date: string): { name: string; year: number } | null {
  for (const e of ERAS) {
    if (date >= e.start) return { name: e.name, year: Number(date.slice(0, 4)) - Number(e.start.slice(0, 4)) + 1 };
  }
  return null;
}

const yearText = (y: number) => (y === 1 ? '元' : String(y));

/** 'YYYY-MM-DD' → 「令和8年1月5日」（読めなければそのまま） */
export function toWareki(date: string | null | undefined): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return date ?? '';
  const e = eraOf(date);
  if (!e) return date;
  return `${e.name}${yearText(e.year)}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
}

/** 'YYYY-MM' → 「令和8年1月」（その月の末日の元号で数える。改元の月は新しい元号） */
export function toWarekiMonth(month: string | null | undefined): string {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return month ?? '';
  const e = eraOf(`${month}-28`);
  if (!e) return month;
  return `${e.name}${yearText(e.year)}年${Number(month.slice(5, 7))}月`;
}
