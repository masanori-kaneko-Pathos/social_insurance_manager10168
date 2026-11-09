// 遡及計算（カタログ【9】）：資格や標準報酬を訂正したときの、月ごとの保険料の差額
// Angular・Firebase に依存しない純粋な関数
//
// 1. 月ごとに、今のデータ（徴収済みとみなす）と訂正後のデータで、それぞれ calcMonthly する
//    料率は、その月の料率（当時の料率）を使う → 1か月分の計算は保険料の画面とまったく同じ
// 2. 差額 ＝ 訂正後 − 訂正前。本人分（円）と会社分（1/1000円）に分ける
// 3. 保険料の徴収の時効は2年（健保法193条・厚年法92条）。納期限（翌月末）から2年を過ぎた月は expired
//    → 追加徴収・返金の合計は、時効になっていない月だけで出す（時効の月も一覧には出す）
// 4. 結果は元のデータとは別に保存する（recalcs）。元の資格・標準報酬は書き換えない

import type { RecalcMonth, RecalcPeriod } from '../../../core/models/employee-records';
import type { PremiumOptions } from '../../../core/models/premium';
import type { RatesForMonth } from '../../../core/models/rates';
import type { StandardRemuneration } from '../../../core/models/remuneration';
import { daysInMonth, monthsBetween, shiftMonth, DateStr, YearMonth } from '../../../shared/utils/date';
import type { CoverageInput, Enrollment } from '../../employees/logic/coverage';
import type { LeaveHolder } from '../../employees/logic/leave';
import { latest } from '../../rates/logic/pick-rates';
import { calcMonthly, RemunerationLike } from './calc-monthly';

export interface RecalcCorrection {
  /** 訂正後の資格（省略 ＝ 今のまま） */
  health?: Enrollment;
  pension?: Enrollment;
  /** 訂正後の標準報酬（適用期間ごと。期間の外は今のまま。health/pension が null ＝ その期間はその保険に入っていない） */
  periods: RecalcPeriod[];
}

export interface RecalcInput {
  employee: CoverageInput & LeaveHolder;
  remunerations: RemunerationLike[];
  correction: RecalcCorrection;
  from: YearMonth;
  to: YearMonth;
  ratesAt: (month: YearMonth) => RatesForMonth;
  options?: PremiumOptions;
  today: DateStr;
}

export interface RecalcResult {
  months: (RecalcMonth & { missing: boolean })[];
  /** 時効になっていない月の合計（本人の追加徴収。マイナスなら返金） */
  diffEmployeeYen: number;
  /** 時効になっていない月の合計（会社の追加分。マイナスなら返還） */
  diffEmployerMilli: number;
  /** 時効の月の合計（参考） */
  expiredEmployeeYen: number;
  expiredEmployerMilli: number;
}

/** その月分の保険料の納期限（翌月末） */
export function dueDateOf(month: YearMonth): DateStr {
  const next = shiftMonth(month, 1);
  return `${next}-${String(daysInMonth(next)).padStart(2, '0')}`;
}

/** 時効（納期限の翌日から2年）を過ぎているか */
export function isExpired(month: YearMonth, today: DateStr): boolean {
  const due = dueDateOf(month);
  const [y, m, d] = due.split('-');
  const limit = `${Number(y) + 2}-${m}-${d}`; // 2年後の同じ日（この日までは徴収できる）
  return today > limit;
}

/** その月の訂正後の期間（なければ null） */
function periodAt(periods: RecalcPeriod[], month: YearMonth): RecalcPeriod | null {
  let found: RecalcPeriod | null = null;
  for (const p of periods) {
    if (p.from <= month && (p.to === null || month < p.to) && (!found || p.from > found.from)) found = p;
  }
  return found;
}

const OFF: Enrollment = { enrolled: false, acquiredDate: null, lostDate: null };

export function recalc(x: RecalcInput): RecalcResult {
  const months: RecalcResult['months'] = [];
  let diffEmployeeYen = 0;
  let diffEmployerMilli = 0;
  let expiredEmployeeYen = 0;
  let expiredEmployerMilli = 0;

  for (const month of monthsBetween(x.from, x.to)) {
    const rates = x.ratesAt(month);
    const before = calcMonthly({ month, employee: x.employee, remunerations: x.remunerations, rates, options: x.options });

    // 訂正後：資格と、その月の標準報酬を置き換える
    const p = periodAt(x.correction.periods, month);
    const cur = latest(x.remunerations, month);
    const std = (kind: 'health' | 'pension'): StandardRemuneration | undefined =>
      p && p[kind] ? p[kind]! : cur?.[kind];
    const employee = {
      ...x.employee,
      health: p && p.health === null ? OFF : (x.correction.health ?? x.employee.health),
      pension: p && p.pension === null ? OFF : (x.correction.pension ?? x.employee.pension),
    };
    const h = std('health');
    const pn = std('pension');
    const rems: RemunerationLike[] = h && pn ? [{ from: month, health: h, pension: pn }] : [];
    const after = calcMonthly({ month, employee, remunerations: rems, rates, options: x.options });

    const expired = isExpired(month, x.today);
    const dEmp = after.employeeYen - before.employeeYen;
    const dEr = after.employerMilli - before.employerMilli;
    if (expired) {
      expiredEmployeeYen += dEmp;
      expiredEmployerMilli += dEr;
    } else {
      diffEmployeeYen += dEmp;
      diffEmployerMilli += dEr;
    }
    months.push({
      month,
      beforeEmployeeYen: before.employeeYen,
      afterEmployeeYen: after.employeeYen,
      beforeTotalMilli: before.totalMilli,
      afterTotalMilli: after.totalMilli,
      expired,
      missing: before.missing.length > 0 || after.missing.length > 0,
    });
  }
  return { months, diffEmployeeYen, diffEmployerMilli, expiredEmployeeYen, expiredEmployerMilli };
}

/**
 * 画面の1行（何月から・何月まで・報酬月額）→ 訂正後の期間
 * 等級は「何月から」の月の等級表で出す。amount が null ＝ その期間は加入していない（健保・厚年とも）
 * to は「この月まで」（画面）→ 期間の to は「この月の翌月から外れる」（RecalcPeriod は to の月を含まない）
 */
export function periodOf(
  from: YearMonth,
  toInclusive: YearMonth | null,
  amount: number | null,
  gradeTables: { kind: 'health' | 'pension'; from: string; grades: { grade: number; standard: number; min: number }[] }[],
): RecalcPeriod | null {
  const to = toInclusive ? shiftMonth(toInclusive, 1) : null;
  if (to !== null && to <= from) return null;
  if (amount === null) return { from, to, health: null, pension: null };
  const table = (kind: 'health' | 'pension') => latest(gradeTables.filter((t) => t.kind === kind), from);
  const h = table('health');
  const p = table('pension');
  if (!h || !p) return null;
  const pick = (rows: { grade: number; standard: number; min: number }[]) => {
    let f = rows[0];
    for (const r of rows) if (r.min <= amount && r.min >= f.min) f = r;
    return { grade: f.grade, standard: f.standard };
  };
  return { from, to, health: pick(h.grades), pension: pick(p.grades) };
}
