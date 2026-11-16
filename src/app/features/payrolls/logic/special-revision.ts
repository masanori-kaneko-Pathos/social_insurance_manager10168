// 標準報酬月額の特例改定（令和9年1月から。療養・育児・介護のための就労調整で報酬が急に下がった人）
// Angular・Firebase に依存しない純粋な関数
//
// 根拠：厚生労働省保険局 保保発0731第4号（別紙1-1・1-2 の記入方法、別紙2 の申立書兼同意書。11/16 に本人が共有）
// ◎ 下がったとき（down）
//   - 「報酬減となった初月」＝ 事業主が届け出た月（※1）。その月に払った報酬の総額で、翌月から改定（④改定年月 ＝ ⑨給与支給月の翌月）
//     → 届出が遅れても前の月には遡れない。届出の月の給与で判断する（firstMonth と届出日の月が同じでないと出さない）
//   - 2等級以上の低下（上限・下限の近くは1等級差でも。※2 ＝ oneGradeException）。固定的賃金の変動は問わない
//   - 支払基礎日数：届出月とその前2か月の全ての月に17日以上（短時間労働者は11日）（別紙2 ⅰ）
//     初月は、就労調整で勤務しなかった日も数える（報酬の有無は問わない。※2）
//   - 対象外：初月の全部を勤務せず報酬がない（※3）／初月の翌月に資格を喪失する（※3）／初月を含めて被保険者期間が3か月未満（※4）
//   - 本人の書面の同意が要る（1(3)）
// ◎ 戻ったとき（up）：特例改定を受けた人が、就労調整の終了・縮小で2等級以上上がった月（報酬増となった初月）の翌月から
//   - 初月の支払基礎日数は、報酬のない日を数えない（※5）
// - 健保と厚年は一緒に届ける。月は支払った月。何回でも使える（届出のたびに申立書）
// - 7〜9月に改定した人は、その年の定時決定の対象外（regular.ts。(3)②）
// - ⑯修正平均額 ＝ 初月の合計から遡及支払額を除いた額（呼ぶ側で amount に渡す）

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
  | 'notFiledMonth' // 下がったとき：届出の月が初月と違う（遡れない）
  | 'noConsent' // 下がったとき：本人の書面の同意がない
  | 'noPay' // 報酬がない（まるごと休み）
  | 'shortDays' // 支払基礎日数が足りない（初月）
  | 'priorMissing' // 下がったとき：前2か月の給与の実績がない
  | 'priorShortDays' // 下がったとき：前2か月に基準未満の月がある
  | 'shortInsured' // 被保険者の期間が3か月に満たない
  | 'lost' // 改定の月に資格がない（翌月に喪失）
  | 'noStandard' // 今の標準報酬がない
  | 'notEnded' // 戻るとき：就労調整が終わっていない
  | 'noDown' // 戻るとき：前に特例改定（down）をしていない
  | 'opposite' // 等級が逆の向きに動く
  | 'noGradeDiff'; // 2等級以上の差がない

export interface SpecialInput {
  direction: SpecialDirection;
  /** 報酬減（増）となった初月（支払った月） */
  firstMonth: string;
  /** 初月の報酬（通貨＋現物から遡及支払額を除いた額 ＝ ⑯修正平均額） */
  amount: number;
  /** 初月の支払基礎日数（down は就労調整で勤務しなかった日も含めた日数） */
  days: number;
  /** その支払月の支払基礎日数の基準（17 か 11） */
  minDaysAt: (paidMonth: string) => number;
  /** 下がったとき：前の月の支払基礎日数（給与の実績。なければ null） */
  daysAt: (paidMonth: string) => number | null;
  /** 届出の日 'YYYY-MM-DD' */
  filedOn: string;
  /** 下がったとき：本人の書面の同意を得た */
  consent: boolean;
  /** 戻ったとき：就労調整が終わった（縮小した）のを確かめた */
  ended: boolean;
  /** 前に特例改定（down）をした改定月（戻るときの前提。なければ空） */
  downMonths: readonly string[];
  employee: CoverageInput;
  remunerations: readonly Remuneration[];
  gradesAt: (month: string) => GradeRows;
}

export interface SpecialResult {
  status: SpecialStatus;
  /** 改定月（初月の翌月） */
  revisedFrom: string;
  beforeAmount: number | null;
  health: InsuranceJudgement | null;
  pension: InsuranceJudgement | null;
}

export function judgeSpecial(x: SpecialInput): SpecialResult {
  const revisedFrom = shiftMonth(x.firstMonth, 1);
  const base: SpecialResult = { status: 'candidate', revisedFrom, beforeAmount: null, health: null, pension: null };
  const stop = (status: SpecialStatus): SpecialResult => ({ ...base, status });
  const down = x.direction === 'down';

  if (x.firstMonth < SPECIAL_REVISION_START) return stop('beforeStart');
  if (down) {
    if (x.filedOn.slice(0, 7) !== x.firstMonth) return stop('notFiledMonth');
    if (!x.consent) return stop('noConsent');
  } else {
    if (!x.downMonths.some((m) => m <= x.firstMonth)) return stop('noDown');
    if (!x.ended) return stop('notEnded');
  }
  if (!(x.amount > 0)) return stop('noPay');
  if (x.days < x.minDaysAt(x.firstMonth)) return stop('shortDays');

  if (down) {
    const prior = [2, 1].map((i) => shiftMonth(x.firstMonth, -i));
    if (prior.some((m) => x.daysAt(m) === null)) return stop('priorMissing');
    if (prior.some((m) => x.daysAt(m)! < x.minDaysAt(m))) return stop('priorShortDays');
    const insured = (m: string) => {
      const c = coverageForMonth(x.employee, m);
      return c.health || c.pension;
    };
    if (![2, 1, 0].every((i) => insured(shiftMonth(x.firstMonth, -i)))) return stop('shortInsured');
  }
  const cov = coverageForMonth(x.employee, revisedFrom);
  if (!cov.health && !cov.pension) return stop('lost');

  const current = standardAt(x.remunerations, shiftMonth(revisedFrom, -1));
  if (!current) return stop('noStandard');

  const rows = x.gradesAt(revisedFrom);
  const judge = (kind: 'health' | 'pension'): InsuranceJudgement => {
    const j = judgeOne(rows[kind], current[kind], x.amount);
    const special = Math.abs(j.diff) === 1 && oneGradeException(rows[kind], current.monthlyAmount, x.amount);
    const big = Math.abs(j.diff) >= 2 || special;
    const right = down ? j.diff < 0 : j.diff > 0;
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
