import { Timestamp } from 'firebase/firestore';
import { PayrollItemCategory } from './payroll-item';

// 毎月の給与の実績（1人 × 1か月 ＝ 1件）
// 置き場所：offices/{officeId}/employees/{employeeId}/payrolls/{YYYY-MM}（ID ＝ 支払った月）
// 金額はすべて円の整数（実績は円単位でしか出てこないため Milli は使わない）

/** その月の状態。産休・育休は employees.leaves から出すのでここには持たない */
export type PayrollState = 'normal' | 'suspended' | 'furlough'; // 通常／休職／一時帰休

/**
 * 給与明細の1行（11/24）。項目名と分類は、保存したときのものを写して持つ
 * （あとで給与の項目の分類を変えても、保存済みの月の計算は変わらない）
 * amount は円・0以上の整数。欠勤控除なども正の数で持ち、分類で引く
 */
export interface PayrollLine {
  name: string;
  category: PayrollItemCategory;
  amount: number;
  /**
   * 本来払う月（支払月 'YYYY-MM'。11/24）。払い忘れ・計算誤りを後の月に精算したとき、その行は本来の月の報酬として計算する
   * （日本年金機構の月額変更届の記入例：遅れて支給した分を本来支給する月に割り振る。起算月も本来の月）
   * 省略・null ＝ この月の分。遡って決まった昇給の差額は、本来の月ではなく分類「遡及支払額」（払った月が起算月）
   */
  forMonth?: string | null;
}

/** 画面で入力する項目 */
export interface PayrollInput {
  /** 通貨による報酬の額（通勤手当・残業代などを含む） */
  cash: number;
  /** cash のうち固定的賃金 */
  fixed: number;
  /**
   * 現物による報酬の額（価額表で換算済み）
   * null ＝ 内訳なし：給与ソフトが現物を支払額（cash）に足して出していて、分けた額がわからない（11/12）
   * 0 ＝ 現物はない。null のときも、合計（cash ＋ 現物）は cash のままで正しい
   */
  inKind: number | null;
  /** 遡及支払額（この月に払った、前の月の分の差額）。なければ 0 */
  retro: number;
  /** 支払基礎日数（決まった値） */
  days: number;
  /** 欠勤日数（日数の候補を出す材料。任意） */
  absentDays: number | null;
  /** 実労働時間（分。任意） */
  workMinutes: number | null;
  /** 計算期間の途中で入社・変更があり、1か月分が出ていない月 */
  prorated: boolean;
  state: PayrollState;
  /**
   * 給与明細の内訳（11/24）。null ＝ 内訳なし（前のデータ・総支給額だけの CSV）
   * 内訳があるときは、cash・fixed・retro は内訳から出した値（payrolls/logic/payroll-lines.ts）
   */
  lines: PayrollLine[] | null;
  /**
   * 欠勤控除を引く前の、毎月決まった額（11/24。固定的賃金が変わったかを見るのに使う）
   * fixed は実際に払った分（欠勤の月は少ない）なので、そのまま比べると欠勤の月を変動と見てしまう。null ＝ 内訳なし（fixed で見る）
   */
  fixedFull: number | null;
}

/** アプリの中の形 */
export interface Payroll extends PayrollInput {
  officeId: string;
  employeeId: string;
  /** 支払った月 'YYYY-MM'（＝ ドキュメントID） */
  paidMonth: string;
}

/** Firestore に保存する形 */
export interface PayrollDoc extends Payroll {
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** 計算に使う現物の額（内訳なしは 0。その分は cash に入っている） */
export function inKindYen(p: Pick<PayrollInput, 'inKind'>): number {
  return p.inKind ?? 0;
}

/** 支払額＋現物（報酬月額の材料） */
export function payTotal(p: Pick<PayrollInput, 'cash' | 'inKind'>): number {
  return p.cash + inKindYen(p);
}

export const PAYROLL_STATES: readonly PayrollState[] = ['normal', 'suspended', 'furlough'];

export function emptyPayrollInput(): PayrollInput {
  return {
    cash: 0,
    fixed: 0,
    inKind: 0,
    retro: 0,
    days: 0,
    absentDays: null,
    workMinutes: null,
    prorated: false,
    state: 'normal',
    lines: null,
    fixedFull: null,
  };
}

/** 固定的賃金が変わったかを見る額（欠勤控除を引く前。内訳がない月は払った額。11/24） */
export function fixedForChange(p: Pick<PayrollInput, 'fixed' | 'fixedFull'>): number {
  return p.fixedFull ?? p.fixed;
}
