// 月の表の1行（画面の文字）⇔ PayrollInput（保存する数値）
// 画面はすべて文字で持ち、「保存する」を押したときにここで数値に直す（共通ルール4：保存するまで保存しない）

import { PayrollInput, PayrollState } from '../../../core/models/payroll';
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
  PayrollError | 'unreadable' | 'cashRequired' | 'fixedRequired' | 'daysRequired';

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

/** 1行を読む。支払額・固定的賃金・日数は必須、現物・遡及は空欄なら 0、欠勤・時間は空欄なら null */
export function readRow(t: PayrollRowText, periodDays: number): RowResult {
  if (isBlank(t)) return { kind: 'blank' };

  const cash = parseNat(t.cash);
  const fixed = parseNat(t.fixed);
  const inKind = t.inKindMerged ? null : parseNat(t.inKind);
  const retro = parseNat(t.retro);
  const days = parseNat(t.days);
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
 * 日数の候補：在籍していた暦日数 − 欠勤日数（欠勤を入れたときだけ引く）
 * ※ 日給月給の「事業所が定めた日数」・日給・時給の出勤日数は、雇用契約（給与の形）ができたら分ける
 */
export function candidateDays(suggested: number, absentText: string): number {
  const absent = parseNat(absentText);
  return absent != null && absent <= suggested ? suggested - absent : suggested;
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
