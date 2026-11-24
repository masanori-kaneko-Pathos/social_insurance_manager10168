/**
 * 随時改定・休業終了時改定の画面の「1人分の候補」と「反映する標準報酬」を組み立てる（11/24 に画面から切り出した）
 * 画面と並行稼働の検算（src/app/testing/parallel-run.ts）が同じ組み立てを使うため。
 * Angular・Firebase に依存しない純粋な関数
 */
import { ContractDoc } from '../../../core/models/contract';
import { Employee } from '../../../core/models/employee';
import { Payroll } from '../../../core/models/payroll';
import { GradeTableDoc } from '../../../core/models/rates';
import { RemunerationDoc, RemunerationInput, StandardRemuneration } from '../../../core/models/remuneration';
import { WageChange } from '../../../core/models/revision';
import { shiftMonth } from '../../../shared/utils/date';
import { bonusRemunerationOf, enrolledFromOf, NaturePaymentLike } from '../../premiums/logic/bonus-nature';
import { withCapRevisions } from '../../rates/logic/cap-revision';
import { AnnualJudgement } from './irregular';
import { InsuranceJudgement, standardAt } from './revision-base';
import { dayRulesOf, RevisionContext, RevisionItem, revisionItems } from './revision-rows';

export interface PersonRevisionSource {
  employee: Employee;
  payrolls: readonly Payroll[];
  remunerations: RemunerationDoc[];
  contracts: ContractDoc[];
  wageChanges: readonly WageChange[];
  /** 事業所の賞与（年4回以上の賞与を各月の報酬に足すため） */
  bonusPayments: readonly NaturePaymentLike[];
}

export interface PersonRevisions {
  /** 支払月 → 実績 */
  payrolls: ReadonlyMap<string, Payroll>;
  items: RevisionItem[];
  /** 届出なしの一斉改定の分も入れた標準報酬の履歴（反映するとき、改定しない保険の今の等級に使う。11/16） */
  remunerations: RemunerationDoc[];
  minDaysAt: (paidMonth: string) => number;
}

/** 1人分の随時改定・休業終了時改定の候補 */
export function personRevisions(s: PersonRevisionSource, ctx: RevisionContext, tables: GradeTableDoc[]): PersonRevisions {
  const e = s.employee;
  const payrolls = new Map(s.payrolls.map((p): [string, Payroll] => [p.paidMonth, p]));
  const bonusMonthlyFor = (y: number) => bonusRemunerationOf(e.id, y, s.bonusPayments, enrolledFromOf(e)).monthly;
  const items = revisionItems(
    { employee: e, contracts: s.contracts, payrolls, remunerations: s.remunerations, wageChanges: s.wageChanges, bonusMonthlyFor },
    ctx,
  );
  return {
    payrolls,
    items,
    remunerations: withCapRevisions(s.remunerations, tables),
    minDaysAt: dayRulesOf({ employee: e, contracts: s.contracts }, ctx).minDaysAt,
  };
}

/** 改定後の標準報酬（改定しない保険は今のまま。厚年の資格がない人は今の値を持っておく） */
export function revisionAfter(
  item: RevisionItem,
  remunerations: readonly RemunerationDoc[],
  annual: boolean,
): { health: StandardRemuneration; pension: StandardRemuneration } {
  const r = item.result;
  const cur = standardAt(remunerations, shiftMonth(r.revisedFrom, -1))!;
  if (annual && item.type === 'irregular' && item.result.annual) {
    const a = item.result.annual;
    const pickA = (j: AnnualJudgement | null, fallback: StandardRemuneration) => (j && j.revise ? j.b : fallback);
    return { health: pickA(a.health, cur.health), pension: pickA(a.pension, cur.pension) };
  }
  const pick = (j: InsuranceJudgement | null, fallback: StandardRemuneration) => (j && j.revise ? j.after : fallback);
  return { health: pick(r.health, cur.health), pension: pick(r.pension, cur.pension) };
}

/** 反映する標準報酬の行（改定月から） */
export function revisionRemuneration(
  item: RevisionItem,
  remunerations: readonly RemunerationDoc[],
  annual: boolean,
): RemunerationInput {
  const r = item.result;
  const a = annual && item.type === 'irregular' ? item.result.annual : null;
  const { health, pension } = revisionAfter(item, remunerations, annual);
  return {
    from: r.revisedFrom,
    reason: item.type === 'irregular' ? 'irregular' : 'leaveEnd',
    monthlyAmount: a ? a.average : r.average!.corrected,
    health,
    pension,
  };
}
