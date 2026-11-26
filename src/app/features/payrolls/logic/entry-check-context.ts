// 「この入力で決まること」の材料を組み立てる（11/26）
// 月の画面（行の下の内訳）と、従業員のページの給与のカードで同じものを使う（2か所で別々に組み立てない）
// Angular・Firebase に依存しない純粋な関数

import type { ContractDoc } from '../../../core/models/contract';
import type { Employee } from '../../../core/models/employee';
import type { CriteriaDoc } from '../../../core/models/master';
import type { Payroll } from '../../../core/models/payroll';
import type { RemunerationDoc } from '../../../core/models/remuneration';
import type { Office } from '../../../core/models/office';
import type { EntryCheckContext } from './entry-check';
import { contractStartMonths, ContractLike } from './irregular';
import { standardAt } from './revision-base';
import { dayRulesOf } from './revision-rows';
import { periodOf, PaySchedule } from './payroll-rows';

export interface EntryCheckSource {
  employee: Employee;
  office: Pick<Office, 'standardHours' | 'specificApplication'>;
  /** 給与の支払月 */
  month: string;
  /** その人のこの月の給与の支払区分（締め日・支払日） */
  schedule: PaySchedule;
  /** この給与から控除する保険料の月（今の標準報酬月額をこの月で見る） */
  premiumMonth: string;
  contracts: readonly ContractDoc[];
  criteria: CriteriaDoc[];
  remunerations: readonly RemunerationDoc[];
  /** 前の月の給与（入力がなければ null） */
  prev: Payroll | null;
}

/**
 * - 支払基礎日数の基準：給与計算期間の末日の区分（短時間労働者なら11日、ほかは17日。dayRulesOf）
 * - 雇用契約の変更：時給・日給・所定労働時間・給与の形が変わった月（contractStartMonths。改定の候補と同じ）
 * - 今の標準報酬月額：この給与から控除する保険料の月のもの
 */
export function entryCheckContextOf(x: EntryCheckSource): EntryCheckContext {
  const contracts = [...x.contracts];
  const withPay: ContractLike[] = contracts.flatMap((c) =>
    c.payType ? [{ from: c.from, payType: c.payType, hourlyWage: c.hourlyWage ?? null, dailyWage: c.dailyWage ?? null, weeklyMinutes: c.weeklyMinutes }] : [],
  );
  const change = contractStartMonths(withPay, (m) => periodOf(m, x.schedule).start).find((s) => s.month === x.month);
  const ctx = {
    office: { standardHours: x.office.standardHours ?? null, specificApplication: x.office.specificApplication },
    criteria: x.criteria,
    schedule: x.schedule,
  };
  const minDays = dayRulesOf({ employee: x.employee, contracts }, ctx).minDaysAt(x.month);
  const rem = standardAt(x.remunerations, x.premiumMonth);
  const current = contractAt(withPay, periodOf(x.month, x.schedule).end);
  return {
    prev: x.prev ? { fixed: x.prev.fixed, fixedFull: x.prev.fixedFull ?? null, inKind: x.prev.inKind } : null,
    standard: rem ? { health: rem.health?.standard ?? null, pension: rem.pension?.standard ?? null } : null,
    minDays,
    contractChange: change?.direction ?? null,
    byUnit: current?.payType === 'hourly' || current?.payType === 'daily',
  };
}

/** その日に効いている契約（from がその日以前でいちばん新しいもの） */
function contractAt<T extends { from: string }>(list: readonly T[], date: string): T | null {
  let found: T | null = null;
  for (const c of list) if (c.from <= date && (!found || c.from > found.from)) found = c;
  return found;
}
