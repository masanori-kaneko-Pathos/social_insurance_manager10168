import { Timestamp } from 'firebase/firestore';

// 毎月の給与の実績（1人 × 1か月 ＝ 1件）
// 置き場所：offices/{officeId}/employees/{employeeId}/payrolls/{YYYY-MM}（ID ＝ 支払った月）
// 金額はすべて円の整数（実績は円単位でしか出てこないため Milli は使わない）

/** その月の状態。産休・育休は employees.leaves から出すのでここには持たない */
export type PayrollState = 'normal' | 'suspended' | 'furlough'; // 通常／休職／一時帰休

/** 画面で入力する項目 */
export interface PayrollInput {
  /** 通貨による報酬の額（通勤手当・残業代などを含む） */
  cash: number;
  /** cash のうち固定的賃金 */
  fixed: number;
  /** 現物による報酬の額（価額表で換算済み） */
  inKind: number;
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
  };
}
