/**
 * 定時決定の画面の「1人分の材料と判定」と「反映する中身」を組み立てる（11/24 に画面から切り出した）
 * 画面と並行稼働の検算（src/app/testing/parallel-run.ts）が同じ組み立てを使うため。
 * Angular・Firebase に依存しない純粋な関数
 */
import { ContractDoc } from '../../../core/models/contract';
import { Employee } from '../../../core/models/employee';
import { Payroll } from '../../../core/models/payroll';
import { RemunerationDoc, RemunerationInput, StandardRemuneration } from '../../../core/models/remuneration';
import { RegularDecision, RegularMethod } from '../../../core/models/revision';
import { gradeOf } from '../../rates/logic/grade';
import {
  BonusRemuneration,
  bonusRemunerationOf,
  bonusTotalOf,
  enrolledFromOf,
  NaturePaymentLike,
  windowOf,
} from '../../premiums/logic/bonus-nature';
import { decideRegular, GradeRows, MonthUse, RegularInput, RegularResult, remunerationAt } from './regular';
import { dayRulesOf, pendingSummerRevision, RevisionContext, revisionItems } from './revision-rows';
import { allocateOtherMonths, OtherMonths } from './payroll-lines';

export interface RegularView {
  employee: Employee;
  result: RegularResult;
  /** 保存済みの定時決定の記録 */
  decision: RegularDecision | null;
  /** 9月分の標準報酬がもうある（反映済み、または手で入れた） */
  septemberExists: boolean;
  remunerations: RemunerationDoc[];
  /** 7〜9月改定の随時改定（休業終了時改定を含む）がまだ反映されていない（11/16）。candidate なら定時決定の反映を止める */
  pending: { revisedFrom: string; status: 'candidate' | 'waiting' } | null;
  /** 判定の材料（賞与に係る報酬の額を直したら、これで判定し直す。11/19） */
  input: RegularInput;
  /** 年4回以上の賞与（7/1前1年の実績から自動で出した額。11/19） */
  bonusAuto: BonusRemuneration;
  /** 7/1前1年に受けた賞与の回数（性質を問わず。報酬に当たる性質がないのに4回以上なら、性質の確認を促す） */
  bonusCount: number;
  /** 払い忘れの精算を本来の月へ割り振った結果（月の額の印と、割り振れなかった分の知らせ。11/24） */
  otherMonths: OtherMonths;
}

export interface RegularReflectItem {
  decision: RegularDecision;
  remuneration: RemunerationInput;
  decisionExists: boolean;
}

/** 定時決定の表に出す人：4/1〜7/1 に在籍していた人（ずっと前に辞めた人は出さない） */
export function regularTargets<E extends Pick<Employee, 'hireDate' | 'retireDate'>>(all: readonly E[], year: number): E[] {
  return all.filter(
    (e) => e.hireDate <= `${year}-07-01` && (e.retireDate == null || e.retireDate >= `${year}-04-01`),
  );
}

export interface RegularViewSource {
  year: number;
  employee: Employee;
  /** その人の給与の実績（支払月 → 実績） */
  payrolls: ReadonlyMap<string, Payroll>;
  remunerations: RemunerationDoc[];
  contracts: ContractDoc[];
  /** 保存済みの定時決定の記録（なければ null） */
  decision: RegularDecision | null;
  /** 事業所の賞与（年4回以上の賞与の判定に使う） */
  bonusPayments: readonly NaturePaymentLike[];
  grades: GradeRows;
  /** 支払基礎日数の基準・随時改定の候補を見るための材料（fromMonth は `${year}-01`） */
  revisionCtx: RevisionContext;
}

/** 1人分の材料と判定（画面の1行） */
export function buildRegularView(s: RegularViewSource): RegularView {
  const { year, employee, remunerations: rems, contracts, bonusPayments, revisionCtx } = s;
  // 払い忘れの精算（本来の月がある内訳の行）は、本来の月の報酬として計算する（11/24）
  const allocated = allocateOtherMonths(s.payrolls);
  const payrolls = allocated.payrolls;
  const input: RegularInput = {
    year,
    employee,
    payrolls,
    remunerations: rems,
    grades: s.grades,
    schedule: revisionCtx.schedule,
    // 短時間労働者は11日、パートは17日 → 15日（R47。11/16）
    ...dayRulesOf({ employee, contracts }, revisionCtx),
  };
  const bonusAuto = bonusRemunerationOf(employee.id, year, bonusPayments, enrolledFromOf(employee));
  // 反映済みなら保存した額、まだなら7/1前1年の実績から出した額
  const bonusMonthly = s.decision?.bonusMonthly ?? bonusAuto.monthly;
  const bonusMonthlyFor = (y: number) => bonusRemunerationOf(employee.id, y, bonusPayments, enrolledFromOf(employee)).monthly;
  return {
    employee,
    input,
    bonusAuto,
    bonusCount: bonusCountOf(employee.id, year, bonusPayments),
    otherMonths: { moved: allocated.moved, unplaced: allocated.unplaced },
    result: decideRegular({ ...input, bonusMonthly }),
    decision: s.decision,
    septemberExists: rems.some((r) => r.from === `${year}-09`),
    remunerations: rems,
    pending: pendingSummerRevision(
      revisionItems({ employee, contracts, payrolls, remunerations: rems, bonusMonthlyFor }, revisionCtx),
      year,
    ),
  };
}

/** 反映できるか（権限は画面で見る） */
export function canReflectRegular(v: RegularView): boolean {
  const r = v.result;
  return (
    !v.septemberExists &&
    v.pending?.status !== 'candidate' &&
    (r.status === 'decided' || (r.status === 'keep' && r.current != null))
  );
}

/** 反映する中身（定時決定の記録と、9月分の標準報酬） */
export function regularReflectItem(
  v: RegularView,
  method: RegularMethod,
  year: number,
  officeId: string,
  pensionGrades: GradeRows['pension'],
): RegularReflectItem {
  const y = year;
  const r = v.result;
  const sum = (ms: MonthUse[]) => ms.filter((m) => m.used).reduce((s, m) => s + m.amount, 0);

  let amount: number;
  let health: StandardRemuneration;
  let pension: StandardRemuneration;
  if (method === 'keep') {
    const cur = remunerationAt(v.remunerations, `${y}-08`)!;
    amount = cur.monthlyAmount;
    health = cur.health;
    pension = cur.pension;
  } else {
    const src = method === 'annual' ? r.annual! : { average: r.average!, next: r.next! };
    amount = src.average;
    health = src.next.health;
    // 厚年の資格がない人（70歳以上被用者など）も、標準報酬相当額として厚年の等級を持っておく
    pension = src.next.pension ?? gradeOf(pensionGrades, amount);
  }

  const used = method === 'annual' ? r.annual!.months : r.months;
  const decision: RegularDecision = {
    officeId,
    employeeId: v.employee.id,
    year: String(y),
    method,
    usedMonths: method === 'keep' ? [] : used.filter((m) => m.used).map((m) => m.month),
    total: method === 'keep' ? 0 : sum(r.months),
    average: r.rawAverage ?? 0,
    corrected: r.hasRetro ? r.average : null,
    annualAverage: r.annual?.average ?? null,
    monthlyAmount: amount,
    seasonal: method === 'annual',
    consent: method === 'annual',
    health,
    pension,
    // 各月の報酬に足した賞与に係る報酬（届の各月の額にも足す。11/19）
    ...(method !== 'keep' && r.bonusMonthly > 0 ? { bonusMonthly: r.bonusMonthly } : {}),
  };
  const remuneration: RemunerationInput = {
    from: `${y}-09`,
    reason: 'regular',
    monthlyAmount: amount,
    health,
    pension,
  };
  return { decision, remuneration, decisionExists: !!v.decision };
}

/** 7/1前1年に受けた賞与の回数（性質を問わず。分割の続き・その年限りは数えない。11/19） */
export function bonusCountOf(employeeId: string, year: number, payments: readonly NaturePaymentLike[]): number {
  const w = windowOf(year);
  return payments.filter(
    (p) =>
      bonusTotalOf(p, employeeId) > 0 &&
      (p.countAs ?? 'normal') === 'normal' &&
      p.paidDate >= w.from &&
      p.paidDate <= w.to,
  ).length;
}
