// 取り込みのエラーを窓で直すときの「欄の種類」（11/17）
// 画面で1件ずつ入れるときと同じ道具で直す：選ぶ列はプルダウン、日付はカレンダー、額は数字の欄
// 選んだ値は、取り込みが読める言葉（「妻」「正社員」など）で表に戻す
// Angular・Firebase に依存しない

/** プルダウンの1つ。value は表に入れる言葉、表示は labelKey（翻訳）か label */
export interface FixChoice {
  value: string;
  labelKey?: string;
  label?: string;
}

/** この欄を出す条件：ほかの列（header）が values のどれかのときだけ（例：続柄が「その他」なら続柄の補足） */
export interface FixWhen {
  header: string;
  values: readonly string[];
}

export type FixField = (
  | { type: 'select'; choices: readonly FixChoice[] }
  | { type: 'date' }
  | { type: 'month' }
  | { type: 'number' }
  | { type: 'text' }
) & { when?: FixWhen };

export const DATE: FixField = { type: 'date' };
export const MONTH: FixField = { type: 'month' };
export const NUMBER: FixField = { type: 'number' };

/** 条件つきの欄（条件に合うと、その列のすぐ下に出る。合わなくなると消えて、値は空に戻る） */
export function shownWhen(field: FixField, header: string, values: readonly string[]): FixField {
  return { ...field, when: { header, values } };
}

export const TEXT: FixField = { type: 'text' };

export function select(choices: readonly FixChoice[]): FixField {
  return { type: 'select', choices };
}

/** 「言葉 → 翻訳の鍵の後ろ」の並びから選択肢を作る（例：choices('contract.payType', [['月給','monthly'], …])） */
export function choices(prefix: string, list: readonly (readonly [string, string])[]): FixField {
  return select(list.map(([value, code]) => ({ value, labelKey: `${prefix}.${code}` })));
}

export const YES_NO: FixField = select([
  { value: 'はい', labelKey: 'common.yes' },
  { value: 'いいえ', labelKey: 'common.no' },
]);

/** 列の鍵 → 欄の種類 を、見出し → 欄の種類 にする（窓は見出しで探す） */
export function byHeader<K extends string>(
  headers: Readonly<Record<K, string>>,
  fields: Partial<Record<K, FixField>>,
): Record<string, FixField> {
  const out: Record<string, FixField> = {};
  for (const [k, f] of Object.entries(fields) as [K, FixField][]) if (headers[k]) out[headers[k]] = f;
  return out;
}

/** 'YYYY-MM-DD' か（カレンダーに入れられるか） */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isIsoMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}
