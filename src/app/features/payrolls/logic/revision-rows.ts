// 「改定の候補」の画面の行（1人分の材料 → 随時改定・休業終了時改定の判定結果）
// Angular・Firebase に依存しない純粋な関数
//
// 月ごとにつなぐもの
// - 支払基礎日数の基準：その支払月の給与計算期間の末日で classify した区分（ガイドブック Q21・Q22）
// - パート（短時間就労者）か：その日の区分が通常の労働者で、契約の雇用形態がパート・アルバイト
// - 厚年の資格：改定する月に厚年の保険料がかかっているか（70歳以上は健保だけ）
// - 等級表：改定する月に使う表

import type { ContractDoc } from '../../../core/models/contract';
import type { Employee } from '../../../core/models/employee';
import type { Payroll } from '../../../core/models/payroll';
import type { GradeTableDoc } from '../../../core/models/rates';
import type { WageChange } from '../../../core/models/revision';
import { shiftMonth } from '../../../shared/utils/date';
import {
  classify,
  ClassifyContract,
  ClassifyCriteria,
  ClassifyOffice,
} from '../../employees/logic/classify';
import { contractAt } from '../../employees/logic/contract-form-model';
import { coverageForMonth } from '../../employees/logic/coverage';
import { pickGradeTable } from '../../rates/logic/grade';
import { findStartMonths, IrregularResult, judgeIrregular } from './irregular';
import { judgeLeaveEnd, LeaveEndResult } from './leave-end';
import { PaySchedule, periodOf } from './payroll-rows';
import { GradeRows, Remuneration } from './regular';
import { minDaysOf } from './revision-base';

export type RevisionEmployee = Pick<
  Employee,
  'id' | 'birthDate' | 'health' | 'pension' | 'optInDate' | 'optOutDate' | 'leaves'
>;

export interface RevisionPerson {
  employee: RevisionEmployee;
  contracts: (ClassifyContract & Pick<ContractDoc, 'employmentType'>)[];
  payrolls: ReadonlyMap<string, Payroll>;
  remunerations: readonly Remuneration[];
  wageChanges?: readonly WageChange[];
}

export interface RevisionContext {
  office: ClassifyOffice;
  criteria: ClassifyCriteria[];
  schedule: PaySchedule;
  gradeTables: GradeTableDoc[];
  /** この月より前に起算する分は出さない（保険料の時効2年を目安に、呼ぶ側で決める） */
  fromMonth: string;
}

export type RevisionItem =
  | { type: 'leaveEnd'; employeeId: string; result: LeaveEndResult; reflected: boolean }
  | { type: 'irregular'; employeeId: string; result: IrregularResult; reflected: boolean };

const PART_TYPES = ['part', 'arbeit'];

export function revisionItems(p: RevisionPerson, ctx: RevisionContext): RevisionItem[] {
  const e = p.employee;
  if (!e.health.enrolled && !e.pension.enrolled) return [];

  const person = {
    birthDate: e.birthDate,
    optInDate: e.optInDate,
    optOutDate: e.optOutDate ?? null,
    contracts: p.contracts,
  };
  /** 支払月 → 給与計算期間の末日の区分 */
  const classAt = (paidMonth: string) => {
    const date = periodOf(paidMonth, ctx.schedule).end;
    return { date, c: classify(person, ctx.office, ctx.criteria, date) };
  };
  const minDaysAt = (m: string) => {
    const { c } = classAt(m);
    return minDaysOf(c.category === 'unknown' ? null : c.category);
  };
  const partAt = (m: string) => {
    const { date, c } = classAt(m);
    const contract = contractAt(p.contracts, date);
    return c.category === 'regular' && !!contract && PART_TYPES.includes(contract.employmentType);
  };
  const pensionAt = (m: string) => coverageForMonth(e, m).pension;
  const gradesAt = (m: string): GradeRows => ({
    health: pickGradeTable(ctx.gradeTables, 'health', m)?.grades ?? [],
    pension: pickGradeTable(ctx.gradeTables, 'pension', m)?.grades ?? [],
  });
  const reflected = (revisedFrom: string) => p.remunerations.some((r) => r.from === revisedFrom);

  const items: RevisionItem[] = [];

  // 休業終了時改定（優先順位が随時改定より上なので先に並べる。カタログ【6】）
  for (const leave of e.leaves ?? []) {
    const r = judgeLeaveEnd({
      leave,
      allLeaves: e.leaves,
      payrolls: p.payrolls,
      remunerations: p.remunerations,
      gradesAt,
      minDaysAt,
      partAt,
      pensionAt,
    });
    if (r && r.startMonth >= ctx.fromMonth) {
      items.push({ type: 'leaveEnd', employeeId: e.id, result: r, reflected: reflected(r.revisedFrom) });
    }
  }

  // 随時改定
  for (const start of findStartMonths(p.payrolls, p.wageChanges ?? [])) {
    if (start.month < ctx.fromMonth) continue;
    const r = judgeIrregular({
      start,
      payrolls: p.payrolls,
      remunerations: p.remunerations,
      gradesAt,
      minDaysAt,
      pensionAt,
    });
    items.push({ type: 'irregular', employeeId: e.id, result: r, reflected: reflected(r.revisedFrom) });
  }
  return items;
}

/** 画面の分け方 */
export type RevisionGroup = 'candidate' | 'waiting' | 'reflected' | 'other';

export function groupOf(item: RevisionItem): RevisionGroup {
  if (item.reflected) return 'reflected';
  if (item.result.status === 'candidate') return 'candidate';
  if (item.result.status === 'waiting') return 'waiting';
  return 'other';
}

/** 保険料の時効（2年）を目安に、出し始める月 */
export function revisionFromMonth(thisMonth: string): string {
  return shiftMonth(thisMonth, -24);
}
