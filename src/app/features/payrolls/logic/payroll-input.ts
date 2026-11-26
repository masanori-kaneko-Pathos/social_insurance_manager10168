// 月の表の1行（画面の文字）⇔ PayrollInput（保存する数値）
// 画面はすべて文字で持ち、「保存する」を押したときにここで数値に直す（共通ルール4：保存するまで保存しない）

import type { PayType } from '../../../core/models/contract';
import { PayrollInput, PayrollState } from '../../../core/models/payroll';
import { hasAmounts, LineDraft, readLines, totalsOf } from './payroll-lines';
import { PayrollError, validatePayroll } from './payroll-rows';
import { formatHours, parseHours, parseNat } from '../../../shared/utils/number';

// ===== 1行 =====

/** 画面の1行（すべて文字。チェックと選択だけはそのまま） */
export interface PayrollRowText {
  cash: string;
  fixed: string;
  inKind: string;
  /** 現物が「内訳なし」（支払額に含まれていて分けた額がない）。true のとき inKind の文字は使わない */
  inKindMerged: boolean;
  retro: string;
  days: string;
  absentDays: string;
  hours: string;
  prorated: boolean;
  state: PayrollState;
}

export function textOf(p: PayrollInput | null): PayrollRowText {
  if (!p) {
    return {
      cash: '',
      fixed: '',
      inKind: '',
      inKindMerged: false,
      retro: '',
      days: '',
      absentDays: '',
      hours: '',
      prorated: false,
      state: 'normal',
    };
  }
  const n = (v: number) => (v === 0 ? '' : String(v)); // 0 は空欄で見せる（現物・遡及）
  return {
    cash: String(p.cash),
    fixed: String(p.fixed),
    inKind: p.inKind === null ? '' : n(p.inKind),
    inKindMerged: p.inKind === null,
    retro: n(p.retro),
    days: String(p.days),
    absentDays: p.absentDays == null ? '' : String(p.absentDays),
    hours: p.workMinutes == null ? '' : formatHours(p.workMinutes),
    prorated: p.prorated,
    state: p.state,
  };
}

export type RowError =
  PayrollError | 'unreadable' | 'cashRequired' | 'fixedRequired' | 'daysRequired' | 'lines';

export type RowResult =
  | { kind: 'blank' } // 何も入れていない行（保存しない。保存済みなら消す）
  | { kind: 'invalid'; errors: RowError[] }
  | { kind: 'ok'; input: PayrollInput };

function isBlank(t: PayrollRowText): boolean {
  return (
    [t.cash, t.fixed, t.inKind, t.retro, t.days, t.absentDays, t.hours].every(
      (s) => s.trim() === '',
    ) &&
    !t.prorated &&
    t.state === 'normal'
  );
}

/**
 * 1行を読む。支払額・固定的賃金は必須、現物・遡及は空欄なら 0、欠勤・時間は空欄なら null
 * 日数：空欄なら autoDays（月給・日給月給の人の自動の日数。11/26）。自動にならない人（時給・日給・契約なし）は必須
 */
export function readRow(t: PayrollRowText, periodDays: number, autoDays: number | null = null): RowResult {
  if (isBlank(t)) return { kind: 'blank' };

  const cash = parseNat(t.cash);
  const fixed = parseNat(t.fixed);
  const inKind = t.inKindMerged ? null : parseNat(t.inKind);
  const retro = parseNat(t.retro);
  const days = t.days.trim() === '' && autoDays !== null ? autoDays : parseNat(t.days);
  const absentDays = parseNat(t.absentDays);
  const workMinutes = parseHours(t.hours);

  const errors: RowError[] = [];
  if ([cash, fixed, inKind, retro, days, absentDays, workMinutes].includes(undefined)) {
    errors.push('unreadable');
  }
  if (cash === null) errors.push('cashRequired');
  if (fixed === null) errors.push('fixedRequired');
  if (days === null) errors.push('daysRequired');
  if (errors.length > 0) return { kind: 'invalid', errors };

  const input: PayrollInput = {
    cash: cash!,
    fixed: fixed!,
    inKind: t.inKindMerged ? null : (inKind ?? 0),
    retro: retro ?? 0,
    days: days!,
    absentDays: absentDays ?? null,
    workMinutes: workMinutes ?? null,
    prorated: t.prorated,
    state: t.state,
    // 表・CSV の総支給額の入力は内訳なし（内訳は行の下の「内訳」で入れる。11/24）
    lines: null,
    fixedFull: null,
  };
  const checks = validatePayroll(input, periodDays);
  return checks.length > 0 ? { kind: 'invalid', errors: checks } : { kind: 'ok', input };
}

/** 保存済みと同じか（同じなら書かない） */
export function sameInput(a: PayrollInput, b: PayrollInput): boolean {
  return (
    a.cash === b.cash &&
    a.fixed === b.fixed &&
    a.inKind === b.inKind &&
    a.retro === b.retro &&
    a.days === b.days &&
    a.absentDays === b.absentDays &&
    a.workMinutes === b.workMinutes &&
    a.prorated === b.prorated &&
    a.state === b.state &&
    a.fixedFull === b.fixedFull &&
    JSON.stringify(a.lines) === JSON.stringify(b.lines)
  );
}

/**
 * 内訳つきの1人分を読む（11/24。月の画面の「内訳」）
 * - drafts が null か、金額が1つも入っていない ＝ 内訳なし：今までどおり総支給額・固定的賃金の文字から読む
 * - 内訳がある：行を読み、総支給額・固定的賃金・昇給差額は内訳から出す（文字の欄は使わない）。
 *   読めない行・分類が決まっていない行があれば 'lines'（行ごとの誤りは readLines で画面に出す）
 */
export function readEntry(
  t: PayrollRowText,
  drafts: readonly LineDraft[] | null,
  payType: PayType | null,
  periodDays: number,
  autoDays: number | null = null,
): RowResult {
  // 金額が1つも入っていなければ内訳なし（ひな形の行を並べただけの月は、今までどおり総支給額の欄から読む）
  if (!hasAmounts(drafts)) return readRow(t, periodDays, autoDays);
  const r = readLines(drafts!);
  if (!r.lines) return { kind: 'invalid', errors: ['lines'] };
  const tot = totalsOf(r.lines, payType);
  const n = (v: number) => (v === 0 ? '' : String(v));
  const row = readRow({ ...t, cash: String(tot.cash), fixed: String(tot.fixed), retro: n(tot.retro) }, periodDays, autoDays);
  if (row.kind !== 'ok') return row;
  return { kind: 'ok', input: { ...row.input, lines: r.lines, fixedFull: tot.fixedFull } };
}

/**
 * 保存済みの日数が、今の自動の日数と同じなら空欄にする（開いたときに「31（自動）」と見せるため。11/26）
 * 自動かどうかの印は保存しない。保存した日数と、今の自動の日数が同じなら自動として扱う
 */
export function autoDaysText(t: PayrollRowText, autoDays: number | null): PayrollRowText {
  if (autoDays === null || t.days.trim() === '' || Number(t.days) !== autoDays) return t;
  return { ...t, days: '' };
}

/**
 * 日数（給与計算の基礎日数）の自動の値（11/25 に算定基礎届の記入・提出ガイドブック「(4) 支払基礎日数とは」どおりに直した）
 * - 月給：出勤日数に関係なく、在籍していた暦日数（欠勤を入れても引かない）
 * - 日給月給（欠勤日数分だけ給料を引く）：欠勤がある月は「事業所が定めた日数（契約の月の所定労働日数）− 欠勤日数」、
 *   欠勤がない月は暦日数
 * - 日給・時給は候補を出さない（実際の出勤日数。有給休暇を含む）。呼ぶ側で除く
 */
export function candidateDays(suggested: number, absentText: string, payType: PayType | null = 'monthly', scheduledDays: number | null = null): number {
  const absent = parseNat(absentText);
  if (payType !== 'dailyMonthly' || absent == null || absent <= 0) return suggested;
  const base = scheduledDays ?? suggested;
  return absent <= base ? base - absent : base;
}

/** 「合計」の列：支払額＋現物（入力中の文字から）。支払額が空・読めない、現物が読めないなら null */
/** 給与の一覧の合計（絞り込んだ人ぶん。空欄・読めない欄は数えない。11/20） */
export interface PayrollSums {
  /** 支払額が入っている人の数 */
  count: number;
  cash: number;
  fixed: number;
  inKind: number;
  /** 支払額＋現物 */
  total: number;
}

export function sumPayrolls(rows: readonly { cash: string; fixed: string; inKind: string }[]): PayrollSums {
  const n = (s: string) => parseNat(s) ?? 0;
  let count = 0, cash = 0, fixed = 0, inKind = 0;
  for (const r of rows) {
    if (typeof parseNat(r.cash) === 'number') count++;
    cash += n(r.cash);
    fixed += n(r.fixed);
    inKind += n(r.inKind);
  }
  return { count, cash, fixed, inKind, total: cash + inKind };
}

export function totalOf(cash: string, inKind: string): number | null {
  const c = parseNat(cash);
  const k = parseNat(inKind);
  if (c == null || k === undefined) return null;
  return c + (k ?? 0);
}
