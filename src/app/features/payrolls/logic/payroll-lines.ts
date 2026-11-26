// 給与明細の内訳（行）から、総支給額・固定的賃金・非固定的賃金・昇給差額を出す（11/24）
// 定時決定・随時改定・保険料の計算は、ここで出した cash・fixed・retro（今までと同じ値）を読む。fixedFull は変動を見つけるのに使う
// Angular・Firebase に依存しない純粋な関数

import type { PayType } from '../../../core/models/contract';
import type { Payroll, PayrollLine } from '../../../core/models/payroll';
import {
  DEFAULT_PAYROLL_ITEMS,
  DEFAULT_TEMPLATE_NAMES,
  PAYROLL_ITEM_CATEGORIES,
  PayrollItemCategory,
  PayrollItemInput,
} from '../../../core/models/payroll-item';
import { toHalfWidth } from '../../../shared/utils/text';
import { allocateSpreads, floorSum, MAX_SPREAD_MONTHS, partsOf, spreadMonthsOf, SPREAD_CATEGORIES } from './spread';

export interface LineTotals {
  /** 総支給額（報酬になる行の合計 − 控除）。報酬にならない行は入れない */
  cash: number;
  /**
   * 固定的賃金（実際に払った分。11/24 に法律どおりへ）：基本給（時給×時間・日給×日数も）＋固定的な手当＋通勤手当 − 控除
   * 単価や額が決まっているものは、時給の人の基本給も固定的賃金（事例集 問1-3・時給単価の変更）
   */
  fixed: number;
  /**
   * 変動を見つけるための額（中だけで使う。欠勤控除を引く前）
   * 月給・日給月給の人は固定的賃金と同じ。時給・日給の人は基本給を除く（働いた時間で額が動くので、額では比べない。
   * 時給・日給・契約時間の変更は、雇用契約から見つける：contractStartMonths）
   */
  fixedFull: number;
  /** 遡及支払額（遡って決まった昇給の差額） */
  retro: number;
  /** 非固定的賃金（総支給額 − 固定的賃金 − 遡及支払額 − 本来の月へ割り振る額。残業・皆勤・歩合など） */
  nonFixed: number;
  /** 本来の月へ割り振る額（払い忘れ・計算誤りの精算。控除はマイナス）。この月の固定的賃金・非固定的賃金には入れない */
  otherMonth: number;
  /**
   * まとめて払った定期代のうち、次の月から割り振る額（11/26。払った額 − この月の分）
   * 総支給額には入れる（この月に払った）が、この月の固定的賃金・非固定的賃金には入れない。この月の分は固定的賃金に入る
   */
  spreadLater: number;
}

/** 本来の月を持てる分類（遡及支払額・報酬にならないものは持たない） */
export const FOR_MONTH_CATEGORIES: readonly PayrollItemCategory[] = ['base', 'fixedAllowance', 'commute', 'variable', 'deduction'];

/** 行が本来の月の分か（この月の分でない） */
export function isOtherMonth(l: Pick<PayrollLine, 'forMonth' | 'category'>): boolean {
  return !!l.forMonth && FOR_MONTH_CATEGORIES.includes(l.category);
}

/** 基本給が固定的賃金になる給与の形（月給・日給月給）。契約が分からないときも月給と見る */
export function baseIsFixed(payType: PayType | null): boolean {
  return payType === null || payType === 'monthly' || payType === 'dailyMonthly';
}

/**
 * 内訳から出す
 * - 総支給額 ＝ 基本給＋固定的な手当＋通勤手当＋非固定的な手当＋昇給差額 − 控除（報酬にならない行は入れない）
 * - 固定的賃金 ＝ 基本給＋固定的な手当＋通勤手当 − 控除（欠勤・遅刻早退で減るのは、基本給などの決まった分のため）
 *   総支給額から昇給差額を除いた額は超えない（非固定的賃金がマイナスにならないように）
 * - 非固定的賃金 ＝ 総支給額 − 固定的賃金 − 昇給差額
 * - 変動を見つけるための額 ＝ 控除を引く前の固定的賃金（時給・日給の人は基本給を除く）
 * - 本来の月がある行（払い忘れの精算）は、総支給額には入れる（この月に払った）が、この月の固定的賃金・非固定的賃金には入れない
 *   定時決定・随時改定・届出では allocateOtherMonths で本来の月へ割り振る
 * - まとめて払った定期代（何か月分がある通勤手当）は、総支給額には全部を入れ、固定的賃金にはこの月の分（月数で割った額の切り捨て）だけ入れる
 *   次の月からの分は allocateOtherMonths（の中の allocateSpreads）で各月に割り振る（11/26）
 */
export function totalsOf(lines: readonly PayrollLine[], payType: PayType | null): LineTotals {
  const own = lines.filter((l) => !isOtherMonth(l) && spreadMonthsOf(l) === 1);
  const sum = (c: PayrollItemCategory) => own.filter((l) => l.category === c).reduce((s, l) => s + l.amount, 0);
  const parts = partsOf(lines.filter((l) => !isOtherMonth(l)), '');
  const share = floorSum(parts);
  const spreadLater = parts.reduce((s, p) => s + p.amount, 0) - share;
  const base = sum('base');
  const deduction = sum('deduction');
  const retro = sum('retro');
  const legal = base + sum('fixedAllowance') + sum('commute') + share;
  const fixedFull = legal - (baseIsFixed(payType) ? 0 : base);
  const otherMonth = lines.filter(isOtherMonth).reduce((s, l) => s + (l.category === 'deduction' ? -l.amount : l.amount), 0);
  const ownCash = legal + sum('variable') + retro - deduction;
  const fixed = Math.max(0, Math.min(legal - deduction, ownCash - retro));
  const cash = ownCash + otherMonth + spreadLater;
  return { cash, fixed, fixedFull, retro, nonFixed: ownCash - fixed - retro, otherMonth, spreadLater };
}

/** 固定的賃金に入る分類（本来の月へ割り振るとき、その月の固定的賃金も動かす） */
const FIXED_CATEGORIES: readonly PayrollItemCategory[] = ['base', 'fixedAllowance', 'commute', 'deduction'];

/**
 * 払い忘れ・計算誤りの精算を、本来の月へ割り振る（11/24）
 * 日本年金機構の月額変更届の記入例：「計算ミス（従業員からの手当の申請遅延も含む）等の場合は、本来生じるはずであった月を起算月とします」
 * 「遅れて支給した分を本来支給する月に割り振って記載します」
 * - 払った月：総支給額から引く（固定的賃金にはもともと入っていない）
 * - 本来の月：総支給額に足す。固定的な分類なら固定的賃金にも足す（その月から固定的賃金が変わった、になる）
 * - 本来の月の実績がないとき（入社前・入力漏れ）は割り振らずに残し、unplaced に出す
 * 定時決定・随時改定・届出の材料だけに使う。給与の実績の画面と保険料の立替の確認は、実際に払った額のまま
 * まとめて払った定期代の月割り（spread.ts の allocateSpreads）も、ここでいっしょに行う（11/26。呼ぶ側を増やさないため）
 */
export interface OtherMonths {
  /** 割り振りで動いた額（支払月 → 増減。払った月はマイナス、本来の月はプラス。動いていない月は入れない） */
  moved: ReadonlyMap<string, number>;
  /** 本来の月の実績がなくて割り振れなかった行 */
  unplaced: { paidMonth: string; forMonth: string; amount: number }[];
}

export function allocateOtherMonths(payrolls: ReadonlyMap<string, Payroll>): OtherMonths & { payrolls: Map<string, Payroll> } {
  const out = new Map<string, Payroll>([...payrolls].map(([m, p]) => [m, { ...p }]));
  const unplaced: { paidMonth: string; forMonth: string; amount: number }[] = [];
  const moved = new Map<string, number>();
  const move = (m: string, v: number) => {
    const n = (moved.get(m) ?? 0) + v;
    if (n === 0) moved.delete(m);
    else moved.set(m, n);
  };
  for (const [m, p] of payrolls) {
    for (const l of p.lines ?? []) {
      // 本来の月が払った月と同じ・後の月なら割り振らない（入力では前の12か月しか選べない。CSV はエラーにする）
      if (!isOtherMonth(l) || l.forMonth! >= m) continue;
      const target = out.get(l.forMonth!);
      const signed = l.category === 'deduction' ? -l.amount : l.amount;
      if (!target) {
        unplaced.push({ paidMonth: m, forMonth: l.forMonth!, amount: signed });
        continue;
      }
      const src = out.get(m)!;
      src.cash -= signed;
      target.cash += signed;
      move(m, -signed);
      move(l.forMonth!, signed);
      if (FIXED_CATEGORIES.includes(l.category)) {
        target.fixed += signed;
        // 変動を見つけるための額（控除を引く前）：控除の割り振りでは動かさない
        if (target.fixedFull !== null && target.fixedFull !== undefined && l.category !== 'deduction') target.fixedFull += l.amount;
      }
    }
  }
  // まとめて払った定期代を、払った月から月数分に割り振る（11/26）
  for (const [m, v] of allocateSpreads(out)) move(m, v);
  return { payrolls: out, moved, unplaced };
}

// ===== 入力中の行（画面・CSV） =====

/** 入力中の1行（分類が決まっていない・金額が読めないこともある） */
export interface LineDraft {
  name: string;
  category: PayrollItemCategory | null;
  amount: string;
  /** 本来払う月（空 ＝ この月の分） */
  forMonth?: string | null;
  /** 何か月分（通勤手当だけ。空・1 ＝ この月の分。11/26） */
  months?: number | null;
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
    else {
      const forMonth = d.forMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(d.forMonth) && FOR_MONTH_CATEGORIES.includes(d.category!) ? d.forMonth : null;
      // 何か月分は通勤手当だけ。本来の月とは一緒に持たない（本来の月を優先。11/26）
      const months =
        !forMonth && SPREAD_CATEGORIES.includes(d.category!) && Number.isInteger(d.months) && d.months! >= 2 && d.months! <= MAX_SPREAD_MONTHS
          ? d.months!
          : null;
      const line: PayrollLine = { name, category: d.category!, amount: amount! };
      if (forMonth) line.forMonth = forMonth;
      if (months) line.months = months;
      lines.push(line);
    }
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
  return lines.map((l) => ({
    name: l.name,
    category: l.category,
    amount: l.amount.toLocaleString('ja-JP'),
    forMonth: l.forMonth ?? null,
    months: l.months ?? null,
  }));
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
 * 項目名の分類を決める：事業所で登録した項目（名前・CSVの見出し）→ アプリのよくある名前 の順
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
