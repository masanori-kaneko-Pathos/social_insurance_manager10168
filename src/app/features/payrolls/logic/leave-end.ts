// 産前産後休業終了時改定・育児休業等終了時改定の候補
// Angular・Firebase に依存しない純粋な関数
//
// 根拠：日本年金機構「育児休業等終了時報酬月額変更届の提出」「産前産後休業終了時報酬月額変更届の提出」と記入例（様式 2232）
// - 終了日の翌日が属する月から3か月の報酬の平均で、4か月目から改定（随時改定に当たらなくても）
// - 今の等級と1等級以上の差（上がる場合も。届に昇給・降給の欄がある）
// - 支払基礎日数が基準（17日。特定適用事業所の短時間労働者は11日）未満の月は除いて平均。少なくとも1か月は基準以上
// - 短時間就労者（パート）は、3か月とも17日未満なら、15日以上17日未満の月で平均
// - 本人の申出が要る（アプリは候補を出すだけ）
// - 育休等：終了日に3歳未満の子を養育／産休：その産休に係る子を養育。産休の翌日に続けて育休等を始めたら、産休のほうは出せない
// - 健康保険と厚生年金は、それぞれ別に判定する

import type { LeaveKind } from '../../../core/models/employee';
import type { Payroll } from '../../../core/models/payroll';
import { addDays, ageAt, shiftMonth, toYearMonth } from '../../../shared/utils/date';
import { endOf } from '../../employees/logic/leave';
import { GradeRows, Remuneration } from './regular';
import {
  averageOfMonths,
  Average,
  InsuranceJudgement,
  judgeOne,
  MIN_DAYS_PART_FALLBACK,
  RevisionMonth,
  standardAt,
} from './revision-base';

/** 判定に使う休業の項目 */
export interface LeaveEndLeave {
  kind: LeaveKind;
  start: string;
  plannedEnd: string | null;
  end: string | null;
  birthDate: string | null; // 産休：出産日
  childBirthDate: string | null; // 育休：子の生年月日
}

export type LeaveEndKind = 'maternity' | 'childcare';

export type LeaveEndStatus =
  | 'candidate' // 健保か厚年のどちらかで1等級以上の差
  | 'waiting' // 3か月の実績がまだそろっていない
  | 'shortDays' // 基準以上の月が1か月もない
  | 'noGradeDiff' // 等級が変わらない
  | 'followedByChildcare' // 産休の翌日に育休等を始めた（産休の終了時改定は出せない）
  | 'noChild' // 子を養育している条件が確かめられない（出産日・子の生年月日がない、子が3歳以上）
  | 'noStandard';

export interface LeaveEndInput {
  leave: LeaveEndLeave;
  /** 同じ人のほかの休業（産休の翌日に育休が始まったかを見る） */
  allLeaves: readonly LeaveEndLeave[];
  payrolls: ReadonlyMap<string, Payroll>;
  remunerations: readonly Remuneration[];
  gradesAt: (month: string) => GradeRows;
  minDaysAt: (paidMonth: string) => number;
  /** その月、短時間就労者（4分の3以上のパート・アルバイト）か（15日の扱いを使うか） */
  partAt: (paidMonth: string) => boolean;
  pensionAt: (month: string) => boolean;
}

export interface LeaveEndResult {
  kind: LeaveEndKind;
  leaveEnd: string;
  status: LeaveEndStatus;
  startMonth: string; // 終了日の翌日が属する月
  revisedFrom: string; // 4か月目
  months: RevisionMonth[];
  average: Average | null;
  health: InsuranceJudgement | null;
  pension: InsuranceJudgement | null;
}

/** 終了時改定の対象になる休業か（出生時育休も育児休業等） */
export function leaveEndKindOf(kind: LeaveKind): LeaveEndKind | null {
  if (kind === 'maternity') return 'maternity';
  if (kind === 'childcare' || kind === 'paternity') return 'childcare';
  return null;
}

/** 子の条件（産休：出産日がある／育休：終了日に3歳未満） */
function childOk(kind: LeaveEndKind, l: LeaveEndLeave, end: string): boolean {
  if (kind === 'maternity') return !!l.birthDate;
  return !!l.childBirthDate && ageAt(l.childBirthDate, end) < 3;
}

/** 終了日が決まっている休業だけ判定する（未定は null） */
export function judgeLeaveEnd(x: LeaveEndInput): LeaveEndResult | null {
  const kind = leaveEndKindOf(x.leave.kind);
  const end = endOf(x.leave);
  if (!kind || !end) return null;

  const next = addDays(end, 1);
  const startMonth = toYearMonth(next);
  const revisedFrom = shiftMonth(startMonth, 3);
  const months: RevisionMonth[] = [0, 1, 2].map((i) => {
    const month = shiftMonth(startMonth, i);
    const payroll = x.payrolls.get(month) ?? null;
    const minDays = x.minDaysAt(month);
    return {
      month,
      payroll,
      amount: payroll ? payroll.cash + payroll.inKind : 0,
      minDays,
      used: !!payroll && payroll.days >= minDays,
    };
  });
  const base: LeaveEndResult = {
    kind,
    leaveEnd: end,
    status: 'waiting',
    startMonth,
    revisedFrom,
    months,
    average: null,
    health: null,
    pension: null,
  };

  if (kind === 'maternity') {
    const followed = x.allLeaves.some(
      (l) => leaveEndKindOf(l.kind) === 'childcare' && l.start === next,
    );
    if (followed) return { ...base, status: 'followedByChildcare' };
  }
  if (!childOk(kind, x.leave, end)) return { ...base, status: 'noChild' };
  if (months.some((m) => !m.payroll)) return base;

  // 基準以上の月がなければ、パートは 15日以上の月を使う
  let used = months;
  if (!months.some((m) => m.used) && months.every((m) => x.partAt(m.month))) {
    used = months.map((m) => ({ ...m, used: m.payroll!.days >= MIN_DAYS_PART_FALLBACK }));
  }
  if (!used.some((m) => m.used)) return { ...base, months: used, status: 'shortDays' };

  const average = averageOfMonths(used)!;
  const current = standardAt(x.remunerations, shiftMonth(revisedFrom, -1));
  if (!current) return { ...base, months: used, average, status: 'noStandard' };

  const rows = x.gradesAt(revisedFrom);
  const judge = (k: 'health' | 'pension'): InsuranceJudgement => {
    const j = judgeOne(rows[k], current[k], average.corrected);
    return { ...j, special: false, revise: j.diff !== 0 };
  };
  const health = judge('health');
  const pension = x.pensionAt(revisedFrom) ? judge('pension') : null;
  const status: LeaveEndStatus =
    health.revise || pension?.revise ? 'candidate' : 'noGradeDiff';
  return { ...base, months: used, status, average, health, pension };
}
