// 給与の項目の設定画面の計算（一覧の行・入力の確かめ。11/24）
// Angular・Firebase に依存しない純粋な関数

import { DEFAULT_PAYROLL_ITEMS, PayrollItem, PayrollItemInput } from '../../../core/models/payroll-item';
import { itemKey } from './payroll-lines';

/** 一覧の1行：事業所で登録した項目か、アプリのよくある名前（初期値） */
export interface PayrollItemRow {
  /** 事業所の項目（初期値の行は null） */
  item: PayrollItem | null;
  value: PayrollItemInput;
}

/** 名前・ほかの言い方の鍵の全部 */
function keysOf(it: PayrollItemInput): string[] {
  return [it.name, ...it.labels].map(itemKey).filter(Boolean);
}

/**
 * 一覧：事業所の項目 → 初期値（事業所の項目と名前・ほかの言い方が重なる初期値は出さない。事業所の分類が勝つ）
 * 並びは、それぞれ初期値の並び（よく出る順）→ 名前の順
 */
export function itemRows(items: readonly PayrollItem[]): PayrollItemRow[] {
  const taken = new Set(items.flatMap(keysOf));
  const own = [...items]
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    .map((item) => ({ item, value: { name: item.name, labels: item.labels, category: item.category } }));
  const defaults = DEFAULT_PAYROLL_ITEMS.filter((d) => !keysOf(d).some((k) => taken.has(k))).map((value) => ({
    item: null,
    value,
  }));
  return [...own, ...defaults];
}

/** ほかの言い方：読点・カンマ・改行で区切る（名前と同じもの・重なりは落とす） */
export function parseItemLabels(text: string, name: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,、，\n]/)) {
    const l = raw.trim();
    if (l && itemKey(l) !== itemKey(name) && !out.some((o) => itemKey(o) === itemKey(l))) out.push(l);
  }
  return out;
}

export type PayrollItemError = 'nameRequired' | 'nameTooLong' | 'tooManyLabels' | 'duplicate';

/** others：ほかの事業所の項目（編集中のものは除く）。初期値と重なるのはよい（事業所の分類が勝つ） */
export function validatePayrollItem(input: PayrollItemInput, others: readonly PayrollItemInput[]): PayrollItemError[] {
  const errors: PayrollItemError[] = [];
  if (!input.name.trim()) errors.push('nameRequired');
  else if (input.name.trim().length > 30) errors.push('nameTooLong');
  if (input.labels.length > 20) errors.push('tooManyLabels');
  const taken = new Set(others.flatMap(keysOf));
  if (keysOf(input).some((k) => taken.has(k))) errors.push('duplicate');
  return errors;
}
