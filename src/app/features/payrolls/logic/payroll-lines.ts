// 給与明細の内訳（行）から、総支給額・毎月決まった額・昇給差額を出す（11/24）
// 定時決定・随時改定・保険料の計算は、ここで出した cash・fixed・retro（今までと同じ値）を読む。fixedFull は変動を見つけるのに使う
// Angular・Firebase に依存しない純粋な関数

import type { PayType } from '../../../core/models/contract';
import type { PayrollLine } from '../../../core/models/payroll';
import {
  DEFAULT_PAYROLL_ITEMS,
  DEFAULT_TEMPLATE_NAMES,
  PAYROLL_ITEM_CATEGORIES,
  PayrollItemCategory,
  PayrollItemInput,
} from '../../../core/models/payroll-item';
import { toHalfWidth } from '../../../shared/utils/text';

export interface LineTotals {
  /** 総支給額（報酬になる行の合計 − 控除）。報酬にならない行は入れない */
  cash: number;
  /** 毎月決まった額のうち、実際に払った分（月給の人の欠勤控除は、ここから引く） */
  fixed: number;
  /** 毎月決まった額（欠勤控除を引く前。変動を見つけるのに使う） */
  fixedFull: number;
  /** 昇給差額 */
  retro: number;
}

/** 基本給が毎月決まった額になる給与の形（月給・日給月給）。契約が分からないときも月給と見る */
export function baseIsFixed(payType: PayType | null): boolean {
  return payType === null || payType === 'monthly' || payType === 'dailyMonthly';
}

/**
 * 内訳から出す
 * - 総支給額 ＝ 基本給＋決まった額の手当＋通勤手当＋月ごとに変わる手当＋昇給差額 − 控除（報酬にならない行は入れない）
 * - 毎月決まった額（引く前）＝ 決まった額の手当＋通勤手当（＋月給・日給月給の人は基本給）
 * - 払った分の毎月決まった額 ＝ 月給・日給月給の人は、引く前の額 − 控除（欠勤で減るのは基本給などの決まった分のため）
 *   時給・日給の人の控除は、月ごとに変わる分から引いたと見る
 *   どちらも、総支給額から昇給差額を除いた額を超えない（月ごとに変わる分がマイナスにならないように）
 */
export function totalsOf(lines: readonly PayrollLine[], payType: PayType | null): LineTotals {
  const sum = (c: PayrollItemCategory) => lines.filter((l) => l.category === c).reduce((s, l) => s + l.amount, 0);
  const base = sum('base');
  const deduction = sum('deduction');
  const retro = sum('retro');
  const fixedFull = sum('fixedAllowance') + sum('commute') + (baseIsFixed(payType) ? base : 0);
  const cash = base + sum('fixedAllowance') + sum('commute') + sum('variable') + retro - deduction;
  const paid = baseIsFixed(payType) ? fixedFull - deduction : fixedFull;
  const fixed = Math.max(0, Math.min(paid, cash - retro));
  return { cash, fixed, fixedFull, retro };
}

// ===== 入力中の行（画面・CSV） =====

/** 入力中の1行（分類が決まっていない・金額が読めないこともある） */
export interface LineDraft {
  name: string;
  category: PayrollItemCategory | null;
  amount: string;
}

export type LineError = 'name' | 'category' | 'amount';
/** 行ではなく全体の誤り：negative ＝ 控除が多すぎて総支給額がマイナス／empty ＝ 行がない */
export type LinesError = 'negative' | 'empty' | 'tooMany';

/** 1件に持てる行の数（Firestore のルールと同じ） */
export const MAX_LINES = 40;

export interface LinesRead {
  /** 行ごとの誤り（添字 ＝ 行の位置）。金額が空の行は飛ばす（保存しない）ので誤りなし */
  lineErrors: Map<number, LineError[]>;
  errors: LinesError[];
  /** 誤りがなければ、保存する行 */
  lines: PayrollLine[] | null;
}

const YEN = /^\d{1,9}$/;

/** 金額の文字（カンマ・円・全角を許す。欠勤控除の「−」は付けても付けなくてもよい） */
export function readAmount(text: string, category: PayrollItemCategory | null): number | null {
  let t = toHalfWidth(text).replace(/[,，円\s]/g, '');
  if (category === 'deduction') t = t.replace(/^[-−ー‐]/, '');
  return YEN.test(t) ? Number(t) : null;
}

export function readLines(drafts: readonly LineDraft[]): LinesRead {
  const lineErrors = new Map<number, LineError[]>();
  const lines: PayrollLine[] = [];
  drafts.forEach((d, i) => {
    const name = d.name.trim();
    // 金額が空の行は保存しない（ひな形の行のうち、その人に関係ない手当は空のままでよい。11/24）
    if (!d.amount.trim()) return;
    const errs: LineError[] = [];
    if (!name || name.length > 30) errs.push('name');
    if (!d.category || !PAYROLL_ITEM_CATEGORIES.includes(d.category)) errs.push('category');
    const amount = readAmount(d.amount, d.category);
    if (amount === null) errs.push('amount');
    if (errs.length > 0) lineErrors.set(i, errs);
    else lines.push({ name, category: d.category!, amount: amount! });
  });
  const errors: LinesError[] = [];
  if (lineErrors.size === 0) {
    if (lines.length === 0) errors.push('empty');
    if (lines.length > MAX_LINES) errors.push('tooMany');
    if (totalsOf(lines, null).cash < 0) errors.push('negative');
  }
  const ok = lineErrors.size === 0 && errors.length === 0;
  return { lineErrors, errors, lines: ok ? lines : null };
}

/** 保存済みの行 → 入力中の行 */
export function toDrafts(lines: readonly PayrollLine[]): LineDraft[] {
  return lines.map((l) => ({ name: l.name, category: l.category, amount: l.amount.toLocaleString('ja-JP') }));
}

/** 金額が1つでも入っているか（入っていなければ内訳なしとして読む） */
export function hasAmounts(drafts: readonly LineDraft[] | null): boolean {
  return (drafts ?? []).some((d) => d.amount.trim() !== '');
}

/**
 * 内訳を入れ始めるときの行（11/24）：その人の前の月の項目名 → 事業所のひな形 → アプリの例 の順
 * 分類は項目名から付ける（決まらない名前は空。入力の中で選ぶ）
 */
export function startDrafts(
  prev: readonly PayrollLine[] | null,
  template: readonly string[] | null,
  items: readonly PayrollItemInput[],
): LineDraft[] {
  if (prev && prev.length > 0) return copyNames(prev);
  const names = template && template.length > 0 ? template : DEFAULT_TEMPLATE_NAMES;
  return names.map((name) => ({ name, category: categoryOf(name, items), amount: '' }));
}

/** 前の月の項目名だけを写す（金額は写さない。昇給した月に前の額のまま保存する間違いを防ぐため） */
export function copyNames(prev: readonly PayrollLine[]): LineDraft[] {
  return prev.map((l) => ({ name: l.name, category: l.category, amount: '' }));
}

// ===== 項目名 → 分類 =====

/** 名前を比べる鍵（全角半角・空白・大小を区別しない） */
export function itemKey(name: string): string {
  return toHalfWidth(name).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

/**
 * 項目名の分類を決める：事業所で登録した項目（名前・ほかの言い方）→ アプリのよくある名前 の順
 * どちらにもなければ null（分類が決まっていない。決めるまで保存できない）
 */
export function categoryOf(name: string, items: readonly PayrollItemInput[]): PayrollItemCategory | null {
  const k = itemKey(name);
  if (!k) return null;
  const hit = (list: readonly PayrollItemInput[]) =>
    list.find((it) => itemKey(it.name) === k || it.labels.some((l) => itemKey(l) === k));
  return (hit(items) ?? hit(DEFAULT_PAYROLL_ITEMS))?.category ?? null;
}

/** 入力の候補に出す名前（事業所の項目 → よくある名前。同じ名前は1つ） */
export function itemNames(items: readonly PayrollItemInput[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of [...items, ...DEFAULT_PAYROLL_ITEMS]) {
    const k = itemKey(it.name);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(it.name);
    }
  }
  return out;
}
