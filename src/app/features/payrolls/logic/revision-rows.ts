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
import { withCapRevisions } from '../../rates/logic/cap-revision';
import { findStartMonths, IrregularResult, judgeIrregular } from './irregular';
import { judgeLeaveEnd, LeaveEndResult } from './leave-end';
import { PaySchedule, periodOf } from './payroll-rows';
import { GradeRows, Remuneration } from './regular';
import { minDaysOf } from './revision-base';
import { irregularBonusYearOf } from '../../premiums/logic/bonus-nature';

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
  /** 定時決定の年 → 賞与に係る報酬（年4回以上の賞与の 年額÷12）。省くと 0（11/19。bonus-nature.ts） */
  bonusMonthlyFor?: (year: number) => number;
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

/**
 * 支払基礎日数の基準を、支払月ごとに出す（随時改定・休業終了時改定・定時決定で共通。11/16 に切り出した）
 * - minDaysAt：その月の区分が短時間労働者なら11日、ほかは17日
 * - partAt：その月、4分の3以上で働くパート・アルバイト（短時間就労者）か（17日の月がなければ15日で読み替える）
 */
export function dayRulesOf(
  p: Pick<RevisionPerson, 'employee' | 'contracts'>,
  ctx: Pick<RevisionContext, 'office' | 'criteria' | 'schedule'>,
): { minDaysAt: (paidMonth: string) => number; partAt: (paidMonth: string) => boolean } {
  const e = p.employee;
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
  return { minDaysAt, partAt };
}

export function revisionItems(p: RevisionPerson, ctx: RevisionContext): RevisionItem[] {
  const e = p.employee;
  if (!e.health.enrolled && !e.pension.enrolled) return [];

  const { minDaysAt, partAt } = dayRulesOf(p, ctx);
  const pensionAt = (m: string) => coverageForMonth(e, m).pension;
  const gradesAt = (m: string): GradeRows => ({
    health: pickGradeTable(ctx.gradeTables, 'health', m)?.grades ?? [],
    pension: pickGradeTable(ctx.gradeTables, 'pension', m)?.grades ?? [],
  });
  const reflected = (revisedFrom: string) => p.remunerations.some((r) => r.from === revisedFrom);
  // 今の等級は、届出なしの一斉改定（等級の上限が上がった月）も入れて比べる。反映済みかは保存した行だけで見る（11/16）
  const remunerations = withCapRevisions(p.remunerations, ctx.gradeTables);

  const items: RevisionItem[] = [];

  // 休業終了時改定（優先順位が随時改定より上なので先に並べる。カタログ【6】）
  for (const leave of e.leaves ?? []) {
    const r = judgeLeaveEnd({
      leave,
      allLeaves: e.leaves,
      payrolls: p.payrolls,
      remunerations,
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
    const revisedFrom = shiftMonth(start.month, 3);
    const r = judgeIrregular({
      start,
      payrolls: p.payrolls,
      remunerations,
      gradesAt,
      minDaysAt,
      pensionAt,
      // 7〜9月の改定はその年、ほかは直前の定時決定の額（irregularBonusYearOf）
      bonusMonthly: p.bonusMonthlyFor?.(irregularBonusYearOf(revisedFrom)) ?? 0,
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

/**
 * 定時決定の年に、7・8・9月改定の随時改定（休業終了時改定を含む）がまだ反映されずに残っているか（11/16）
 * - 実務の順番：先に7月改定などの月額変更届 → その人は算定基礎届を出さない（定時決定から外れる）
 * - decideRegular は「反映済みの改定」でしか外せないので、反映前の候補をここで拾って画面に知らせる
 * - candidate（3か月そろって改定に当たる）は定時決定の反映を止める。waiting（月がそろうのを待っている）は知らせるだけ
 * いちばん早い改定月を返す（なければ null）
 */
export function pendingSummerRevision(
  items: readonly RevisionItem[],
  year: number,
): { revisedFrom: string; status: 'candidate' | 'waiting' } | null {
  const hits = items
    .filter((i) => !i.reflected)
    .filter((i) => i.result.revisedFrom >= `${year}-07` && i.result.revisedFrom <= `${year}-09`)
    .flatMap((i) => {
      const g = groupOf(i);
      return g === 'candidate' || g === 'waiting' ? [{ revisedFrom: i.result.revisedFrom, status: g }] : [];
    })
    .sort((a, b) => (a.status === b.status ? a.revisedFrom.localeCompare(b.revisedFrom) : a.status === 'candidate' ? -1 : 1));
  return hits[0] ?? null;
}
