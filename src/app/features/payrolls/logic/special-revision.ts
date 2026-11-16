// 標準報酬月額の特例改定（令和9年1月から。療養・育児・介護で報酬が急に下がった人）
// Angular・Firebase に依存しない純粋な関数
//
// 根拠：厚生労働省保険局 保保発0731第4号とQ&A（11/16 に本人が確認）
// - 療養・育児・介護のために働けない日・時間が増えて報酬が下がったとき、本人の申出（同意）で、
//   下がった報酬を最初に払った月の翌月から改定する（1か月分の報酬で決める。随時改定の3か月を待たない）
// - 届出の月より前には遡らない（アプリの読み：届出が遅れたら、申出の月から改定。△ 確認待ち）
// - 2等級以上の差（上限・下限の近くは1等級差でも。随時改定と同じ oneGradeException）
// - 支払基礎日数：下がったとき（down）は、療養等で休んだ日も数えて基準（17日・短時間11日）以上
//                  戻ったとき（up）は、給与の出ない日を数えない、ふだんの数え方で基準以上
// - 対象外：最初の月がまるごと休みで報酬がない／翌月に資格を喪失する／被保険者の期間が3か月に満たない
// - 戻ったとき（up）：療養等が終わって報酬が上がった月の翌月から改定。前に特例改定（down）をした人だけ
// - 健保と厚年は一緒に届ける。月は支払った月で判断。何回でも使える
// - 7〜9月に改定した人は、その年の定時決定の対象外（regular.ts）

import type { SpecialRevisionReason } from '../../../core/models/revision';
import { shiftMonth } from '../../../shared/utils/date';
import { coverageForMonth, type CoverageInput } from '../../employees/logic/coverage';
import { oneGradeException, GradeRows, Remuneration } from './regular';
import { InsuranceJudgement, judgeOne, standardAt } from './revision-base';

/** 特例改定が始まる月（この月に払った報酬から） */
export const SPECIAL_REVISION_START = '2027-01';

export type SpecialReason = SpecialRevisionReason;
export const SPECIAL_REASONS: readonly SpecialReason[] = ['medical', 'childcare', 'nursing'];
export type SpecialDirection = 'down' | 'up';

export type SpecialStatus =
  | 'candidate' // 改定に当たる
  | 'beforeStart' // 2027年1月より前の月
  | 'noPay' // 報酬がない（まるごと休み）
  | 'shortDays' // 支払基礎日数が足りない
  | 'shortInsured' // 被保険者の期間が3か月に満たない
  | 'lost' // 改定の月に資格がない（翌月に喪失）
  | 'noStandard' // 今の標準報酬がない
  | 'notEnded' // 戻るとき：療養等が終わっていない
  | 'noDown' // 戻るとき：前に特例改定（down）をしていない
  | 'opposite' // 等級が逆の向きに動く
  | 'noGradeDiff'; // 2等級以上の差がない

export interface SpecialInput {
  direction: SpecialDirection;
  /** 下がった（戻った）報酬を最初に払った月 */
  firstMonth: string;
  /** その月の報酬（通貨＋現物） */
  amount: number;
  /** 支払基礎日数（down は療養等で休んだ日も含めて数えた日数） */
  days: number;
  /** その月の支払基礎日数の基準（17 か 11） */
  minDays: number;
  /** 本人の申出（同意）の日 'YYYY-MM-DD' */
  requestedOn: string;
  /** 戻るとき：療養・育児・介護が終わった（人が確かめる） */
  ended: boolean;
  /** 前に特例改定（down）をした改定月（戻るときの前提。なければ空） */
  downMonths: readonly string[];
  employee: CoverageInput;
  remunerations: readonly Remuneration[];
  gradesAt: (month: string) => GradeRows;
}

export interface SpecialResult {
  status: SpecialStatus;
  /** 改定月（最初の月の翌月。申出がそれより後なら申出の月） */
  revisedFrom: string;
  /** 申出が遅れて、改定月が後ろにずれた */
  delayed: boolean;
  beforeAmount: number | null;
  health: InsuranceJudgement | null;
  pension: InsuranceJudgement | null;
}

export function judgeSpecial(x: SpecialInput): SpecialResult {
  const natural = shiftMonth(x.firstMonth, 1);
  const requested = x.requestedOn.slice(0, 7);
  const revisedFrom = /^\d{4}-\d{2}$/.test(requested) && requested > natural ? requested : natural;
  const base: SpecialResult = {
    status: 'candidate',
    revisedFrom,
    delayed: revisedFrom !== natural,
    beforeAmount: null,
    health: null,
    pension: null,
  };
  const stop = (status: SpecialStatus): SpecialResult => ({ ...base, status });

  if (x.firstMonth < SPECIAL_REVISION_START) return stop('beforeStart');
  if (x.direction === 'up') {
    if (!x.downMonths.some((m) => m <= x.firstMonth)) return stop('noDown');
    if (!x.ended) return stop('notEnded');
  }
  if (!(x.amount > 0)) return stop('noPay');
  if (x.days < x.minDays) return stop('shortDays');

  const insured = (m: string) => {
    const c = coverageForMonth(x.employee, m);
    return c.health || c.pension;
  };
  if (![2, 1, 0].every((i) => insured(shiftMonth(x.firstMonth, -i)))) return stop('shortInsured');
  const cov = coverageForMonth(x.employee, revisedFrom);
  if (!cov.health && !cov.pension) return stop('lost');

  const current = standardAt(x.remunerations, shiftMonth(revisedFrom, -1));
  if (!current) return stop('noStandard');

  const rows = x.gradesAt(revisedFrom);
  const judge = (kind: 'health' | 'pension'): InsuranceJudgement => {
    const j = judgeOne(rows[kind], current[kind], x.amount);
    const special = Math.abs(j.diff) === 1 && oneGradeException(rows[kind], current.monthlyAmount, x.amount);
    const big = Math.abs(j.diff) >= 2 || special;
    const right = x.direction === 'down' ? j.diff < 0 : j.diff > 0;
    return { ...j, special, revise: big && right };
  };
  const health = cov.health ? judge('health') : null;
  const pension = cov.pension ? judge('pension') : null;
  const judged = [health, pension].filter((j): j is InsuranceJudgement => j !== null);
  const status: SpecialStatus = judged.some((j) => j.revise)
    ? 'candidate'
    : judged.some((j) => Math.abs(j.diff) >= 2 || j.special)
      ? 'opposite'
      : 'noGradeDiff';
  return { ...base, status, beforeAmount: current.monthlyAmount, health, pension };
}

/** 改定後の標準報酬（改定しない保険・資格のない保険は今のまま） */
export function specialAfter(
  r: SpecialResult,
  current: Pick<Remuneration, 'health' | 'pension'>,
): Pick<Remuneration, 'health' | 'pension'> {
  return {
    health: r.health?.revise ? r.health.after : current.health,
    pension: r.pension?.revise ? r.pension.after : current.pension,
  };
}
