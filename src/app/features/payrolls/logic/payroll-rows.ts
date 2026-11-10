// 給与の実績の純粋な関数（Angular・Firebase に依存しない）
// - 支払った月 → 給与の対象期間（締日から出す）
// - 表に出す人（対象期間に在籍していた人）・入れ忘れの人（対象期間に加入していた人）
// - 支払基礎日数の候補（今は月給として暦日数。給与の形は雇用契約ができたら足す）
// - 入力チェック
//

import { Payroll, PayrollInput, PAYROLL_STATES } from '../../../core/models/payroll';
import { PayrollSettings } from '../../../core/models/office';
import {
  addDays,
  DateStr,
  daysInclusive,
  daysInMonth,
  shiftMonth,
  YearMonth,
} from '../../../shared/utils/date';

// ===== 型（今あるモデルから必要な所だけ受け取る） =====

/** 事業所の給与の設定のうち、ここで使う所（締日・支払日・支払月） */
export type PaySchedule = Pick<PayrollSettings, 'closingDay' | 'payDay' | 'payMonth'>;

interface Enrollment {
  enrolled: boolean;
  acquiredDate: string | null;
  lostDate: string | null;
}

/** 従業員のうち、ここで使う所 */
export interface PayrollEmployee {
  id: string;
  hireDate: string;
  retireDate: string | null;
  health: Enrollment;
  pension: Enrollment;
}

export interface Period {
  start: string; // 'YYYY-MM-DD'
  end: string; // 'YYYY-MM-DD'（この日を含む）
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** その月の締日（31 や 30 は、その月の末日で止める） */
function closeDateOf(ym: YearMonth, closingDay: number): DateStr {
  return `${ym}-${pad2(Math.min(closingDay, daysInMonth(ym)))}`;
}

// ===== 対象期間 =====

/**
 * 支払った月 → 給与の対象期間
 * 例：月末締め・翌月払い、2026-11 払い → 2026-10-01〜2026-10-31
 *     20日締め・翌月払い、2026-11 払い → 2026-09-21〜2026-10-20
 */
export function periodOf(paidMonth: string, s: PaySchedule): Period {
  const endMonth = s.payMonth === 'next' ? shiftMonth(paidMonth, -1) : paidMonth;
  const end = closeDateOf(endMonth, s.closingDay);
  const prevClose = closeDateOf(shiftMonth(endMonth, -1), s.closingDay);
  return { start: addDays(prevClose, 1), end };
}

/**
 * 支払日を過ぎた最新の「支払った月」（＝ 実績が入っているべき月）
 * 支払日の当日は「過ぎた」に含める
 */
export function latestPaidMonth(today: string, s: PaySchedule): string {
  const ym = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const payDay = Math.min(s.payDay, daysInMonth(ym));
  return day >= payDay ? ym : shiftMonth(ym, -1);
}

// ===== 在籍・加入 =====

/** 対象期間に1日でも在籍していたか（退職日は在籍に含める） */
export function employedDuring(e: PayrollEmployee, p: Period): boolean {
  return e.hireDate <= p.end && (e.retireDate == null || e.retireDate >= p.start);
}

function enrolledDuring(x: Enrollment, p: Period): boolean {
  // 喪失日の前日まで被保険者
  return (
    x.enrolled &&
    x.acquiredDate != null &&
    x.acquiredDate <= p.end &&
    (x.lostDate == null || x.lostDate > p.start) &&
    (x.lostDate == null || x.lostDate > x.acquiredDate) // 到達後の入社（資格を取っていない）
  );
}

/** 対象期間に健保か厚年のどちらかに1日でも加入していたか */
export function insuredDuring(e: PayrollEmployee, p: Period): boolean {
  return enrolledDuring(e.health, p) || enrolledDuring(e.pension, p);
}

// ===== 支払基礎日数の候補 =====

/**
 * 月給（欠勤控除なし）としての候補：対象期間のうち在籍していた日の暦日数
 * 日給月給・日給・時給は、雇用契約（給与の形）を足すときに分ける
 */
export function suggestDays(e: PayrollEmployee, p: Period): number {
  if (!employedDuring(e, p)) return 0;
  const start = e.hireDate > p.start ? e.hireDate : p.start;
  const end = e.retireDate != null && e.retireDate < p.end ? e.retireDate : p.end;
  return daysInclusive(start, end);
}

// ===== 表の行と入れ忘れ =====

export interface PayrollRow {
  employeeId: string;
  /** 保存済みの実績。なければ null */
  saved: Payroll | null;
  insured: boolean;
  suggestedDays: number;
  /** 期間の途中で入社・退職した（日割りの候補） */
  partial: boolean;
}

/** 月の表の行。対象期間に在籍していた人だけ、渡された順のまま */
export function payrollRows(
  employees: readonly PayrollEmployee[],
  p: Period,
  saved: ReadonlyMap<string, Payroll>,
): PayrollRow[] {
  const total = daysInclusive(p.start, p.end);
  return employees
    .filter((e) => employedDuring(e, p))
    .map((e) => {
      const suggestedDays = suggestDays(e, p);
      return {
        employeeId: e.id,
        saved: saved.get(e.id) ?? null,
        insured: insuredDuring(e, p),
        suggestedDays,
        partial: suggestedDays < total,
      };
    });
}

/** 入れ忘れ：対象期間に加入していて、実績がない人の ID */
export function missingPayrolls(
  employees: readonly PayrollEmployee[],
  p: Period,
  saved: ReadonlyMap<string, Payroll>,
): string[] {
  return employees.filter((e) => insuredDuring(e, p) && !saved.has(e.id)).map((e) => e.id);
}

// ===== 入力チェック =====

export type PayrollError =
  | 'notInteger' // 整数でない・負の数
  | 'tooLarge' // 金額が大きすぎる
  | 'fixedOverCash' // 固定的賃金が支払額より大きい
  | 'retroOverTotal' // 遡及支払額が合計より大きい
  | 'daysOutOfRange' // 支払基礎日数が 0〜対象期間の日数 の外
  | 'absentOutOfRange'
  | 'minutesOutOfRange'
  | 'badState';

const MAX_YEN = 99_999_999; // remunerations.monthlyAmount と同じ上限
const MAX_MINUTES = 31 * 24 * 60;

const isNat = (v: number) => Number.isSafeInteger(v) && v >= 0;

/** 問題がなければ空の配列。periodDays は対象期間の日数（日数の上限に使う） */
export function validatePayroll(x: PayrollInput, periodDays: number): PayrollError[] {
  const errors: PayrollError[] = [];
  const yen = [x.cash, x.fixed, x.inKind, x.retro];
  if (!yen.every(isNat)) {
    errors.push('notInteger');
  } else {
    if (yen.some((v) => v > MAX_YEN)) errors.push('tooLarge');
    if (x.fixed > x.cash) errors.push('fixedOverCash');
    if (x.retro > x.cash + x.inKind) errors.push('retroOverTotal');
  }
  if (!isNat(x.days) || x.days > periodDays) errors.push('daysOutOfRange');
  if (x.absentDays != null && (!isNat(x.absentDays) || x.absentDays > periodDays)) {
    errors.push('absentOutOfRange');
  }
  if (x.workMinutes != null && (!isNat(x.workMinutes) || x.workMinutes > MAX_MINUTES)) {
    errors.push('minutesOutOfRange');
  }
  if (!PAYROLL_STATES.includes(x.state)) errors.push('badState');
  return errors;
}

/** 隠れた列（cash・fixed・days 以外）に初期値でない値が入っているか（行の印に使う） */
export function hasExtra(x: PayrollInput): boolean {
  return (
    x.inKind !== 0 ||
    x.retro !== 0 ||
    x.absentDays != null ||
    x.workMinutes != null ||
    x.prorated ||
    x.state !== 'normal'
  );
}
