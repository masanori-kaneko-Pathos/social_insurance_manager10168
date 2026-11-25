// 給与の実績の純粋な関数（Angular・Firebase に依存しない）
// - 支払った月 → 給与の対象期間（締日から出す）
// - 表に出す人（対象期間に在籍していた人）・入れ忘れの人（対象期間に加入していた人）
// - 支払基礎日数の候補（月給として、支払い対象になった日の暦日数。入社・退職・休業の月は日割り）
// - 入力チェック
//

import { inKindYen, Payroll, PayrollInput, PAYROLL_STATES, payTotal } from '../../../core/models/payroll';
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
  /** 休業（産休・育休・介護休業・休職）。月の途中で始まる・終わる月の支払基礎日数の候補に使う（11/25） */
  leaves?: readonly { start: string; end: string | null; plannedEnd: string | null }[];
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

/**
 * 対象期間に1日でも休業（産休・育休など）していたか（給与の一覧の「休業」の札。11/20）
 * 終了日がなければ予定日、それもなければ続いているとみなす
 */
export function onLeaveDuring(
  e: { leaves?: readonly { start: string; end?: string | null; plannedEnd?: string | null }[] },
  p: Period,
): boolean {
  return (e.leaves ?? []).some((l) => l.start <= p.end && (l.end ?? l.plannedEnd ?? '9999-12-31') >= p.start);
}

// ===== 支払基礎日数の候補 =====

/**
 * 月給（欠勤控除なし）としての候補：対象期間のうち、給料の支払い対象になった日の暦日数
 * - 入社・退職の月は在籍した日
 * - 休業が月の途中で始まる・終わる月は、休業の日を除く（6/1〜6/9 の日割りで 6/10 から産休 → 9日。11/25）
 *   ガイドブック「支払基礎日数とは、その報酬の支払い対象となった日数」「月給制は出勤日数に関係なく暦日数」
 * - 期間を丸ごと休業している月は除かない（その月に給与があるのは休職給などを払った月。0日にしない）
 * 日給月給の欠勤控除は candidateDays、日給・時給は出勤日数（呼ぶ側で分ける）
 */
export function suggestDays(e: PayrollEmployee, p: Period): number {
  if (!employedDuring(e, p)) return 0;
  const start = e.hireDate > p.start ? e.hireDate : p.start;
  const end = e.retireDate != null && e.retireDate < p.end ? e.retireDate : p.end;
  const days = daysInclusive(start, end);
  const off = leaveDaysWithin(e.leaves ?? [], start, end);
  return off > 0 && off < days ? days - off : days;
}

/** start〜end のうち休業の日数（重なる休業は1回だけ数える。終わりが決まっていない休業は end まで） */
export function leaveDaysWithin(
  leaves: readonly { start: string; end: string | null; plannedEnd: string | null }[],
  start: string,
  end: string,
): number {
  const spans = leaves
    .map((l) => ({ s: l.start > start ? l.start : start, e: (l.end ?? l.plannedEnd ?? end) < end ? (l.end ?? l.plannedEnd)! : end }))
    .filter((x) => x.s <= x.e)
    .sort((a, b) => a.s.localeCompare(b.s));
  let total = 0;
  let curS: string | null = null;
  let curE = '';
  for (const x of spans) {
    if (curS !== null && x.s <= addDays(curE, 1)) {
      if (x.e > curE) curE = x.e;
      continue;
    }
    if (curS !== null) total += daysInclusive(curS, curE);
    curS = x.s;
    curE = x.e;
  }
  if (curS !== null) total += daysInclusive(curS, curE);
  return total;
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

/**
 * 給与の支払区分が人ごとに違うときの、その支払月の1行（11/24）
 * 区分（締め日・支払月）が同じ人ごとに対象期間を出し、今までの payrollRows で行を作る。並びは元の従業員の順
 */
export function payrollRowsFor(
  employees: readonly PayrollEmployee[],
  paidMonth: string,
  scheduleOf: (e: PayrollEmployee) => PaySchedule,
  saved: ReadonlyMap<string, Payroll>,
): (PayrollRow & { period: Period })[] {
  const byKey = new Map<string, { period: Period; list: PayrollEmployee[] }>();
  for (const e of employees) {
    const s = scheduleOf(e);
    const key = `${s.closingDay}_${s.payMonth}`;
    if (!byKey.has(key)) byKey.set(key, { period: periodOf(paidMonth, s), list: [] });
    byKey.get(key)!.list.push(e);
  }
  const rows = new Map<string, PayrollRow & { period: Period }>();
  for (const { period, list } of byKey.values()) {
    for (const r of payrollRows(list, period, saved)) rows.set(r.employeeId, { ...r, period });
  }
  return employees.flatMap((e) => (rows.has(e.id) ? [rows.get(e.id)!] : []));
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
  const yen = [x.cash, x.fixed, inKindYen(x), x.retro];
  if (!yen.every(isNat)) {
    errors.push('notInteger');
  } else {
    if (yen.some((v) => v > MAX_YEN)) errors.push('tooLarge');
    if (x.fixed > x.cash) errors.push('fixedOverCash');
    if (x.retro > payTotal(x)) errors.push('retroOverTotal');
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
/** 「入力する項目を増やす」で出る列のうち、値の入っている列（札に名前を出す。11/18） */
export type ExtraField = 'hours' | 'retro' | 'inKind' | 'absentDays' | 'prorated' | 'state';
export function extraFields(x: PayrollInput): ExtraField[] {
  const out: ExtraField[] = [];
  if (x.workMinutes != null) out.push('hours');
  if (x.retro !== 0) out.push('retro');
  if (x.inKind !== 0) out.push('inKind');
  if (x.absentDays != null) out.push('absentDays');
  if (x.prorated) out.push('prorated');
  if (x.state !== 'normal') out.push('state');
  return out;
}

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
