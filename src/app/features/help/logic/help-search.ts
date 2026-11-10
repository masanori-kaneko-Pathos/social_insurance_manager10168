/**
 * ヘルプの絞り込み（Angular・Firebase に依存しない純粋な関数）
 * 見出しと本文のどちらかに、打った言葉が全部入っている項目を出す（空白で区切ると「かつ」）
 * ひらがな・カタカナ、全角・半角、大文字・小文字の違いは気にしない
 */

export const HELP_TOPICS = [
  'todo',
  'acquire',
  'loss',
  'payroll',
  'inKind',
  'regular',
  'irregular',
  'leave',
  'care',
  'agreement',
  'csv',
  'myPage',
  'roles',
] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];

/** 比べやすい形にそろえる（カタカナ → ひらがな、全角英数 → 半角、小文字） */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function matchesHelp(text: string, query: string): boolean {
  const words = normalizeForSearch(query).split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return true;
  const t = normalizeForSearch(text);
  return words.every((w) => t.includes(w));
}
