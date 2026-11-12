// 随時改定（月額変更届）の候補
// Angular・Firebase に依存しない純粋な関数
//
// 根拠：日本年金機構「算定基礎届の記入・提出ガイドブック」令和8年度版 24〜26ページ、「随時改定」の手続きページ
// 次の3つをすべて満たすとき、起算月から4か月目に改定する
//   1. 固定的賃金が変わった（その報酬を払った月 ＝ 起算月。遡及して昇給し差額を払った月も起算月）
//   2. 起算月から3か月とも、支払基礎日数が基準以上（17日。特定適用事業所の短時間労働者は11日）
//   3. 3か月の平均（遡及を引いた修正平均）の等級と、今の等級に2等級以上の差
//      上限・下限をまたぐときは1等級差でも（oneGradeException。R3 の表と一致）
// 固定的賃金が上がったのに平均の等級が下がった（逆も）なら改定しない
// 健康保険と厚生年金は、それぞれ別に判定する（健保法43条・厚年法23条。○ 条文の作りからの読み）
//
// 年間平均による保険者算定（annual。平成30年3月1日 事務連絡「随時改定の場合に行う保険者算定の基準の見直しに関するQ＆A」）
//   A：ふだんの3か月の平均（修正平均）。今の等級と2等級以上の差（＝ ふつうの候補）であることが前提
//   B：起算月から3か月の固定的賃金の平均 ＋ 起算月前の9か月と起算月から3か月の非固定的賃金の平均（Q1・Q7）
//   A と B に2等級以上の差（上限・下限の近くは1等級差でも。Q15）があれば候補
//   数える月：支払基礎日数が基準以上（17日・短時間11日）で、休職・一時帰休でない月（Q8）。3か月のほかに1か月以上（Q11）
//   B の等級が、昇給なのに今の等級以下（降給なのに以上）なら改定しない（Q16）。今の等級と B は1等級差でもよい（Q15）
//   「業務の性質上、例年発生する」かと本人の同意は、アプリでは決めない（人が確かめて記録する。Q2・Q18）
// ※ アプリの読み：現物は固定的なもの（社宅・食事）として固定的賃金の側に入れる。非固定 ＝ 支払額 − 固定的賃金 − 遡及支払額
// ※ 月の途中の資格取得の月（Q8）は、まだ除いていない（入社月の実績は支払基礎日数で外れることが多い）

import { inKindYen, payTotal, type Payroll } from '../../../core/models/payroll';
import type { WageChange } from '../../../core/models/revision';
import type { StandardRemuneration } from '../../../core/models/remuneration';
import { shiftMonth } from '../../../shared/utils/date';
import { gradeOf } from '../../rates/logic/grade';
import { oneGradeException, GradeRows, Remuneration } from './regular';
import {
  averageOfMonths,
  Average,
  InsuranceJudgement,
  judgeOne,
  RevisionMonth,
  standardAt,
} from './revision-base';

export type Direction = 'up' | 'down' | 'unclear';

/** 起算月の候補（固定的賃金が変わった支払月） */
export interface StartMonth {
  month: string;
  direction: Direction;
  /** fixed：固定的賃金の額が変わった／retro：遡及支払がある／manual：人が足した */
  source: 'fixed' | 'retro' | 'manual';
}

/**
 * 起算月の候補を出す
 * - 給与の実績の fixed（固定的賃金）が、前の月の実績と変わった月（前の月が0円なら、最後に払った月と比べる）
 * - 遡及支払額（retro）がある月（さかのぼった昇給の差額を払った月。26ページの記入例）
 * - wageChanges で人が足した月（manual）を足し、外した月（dismissed）を除く
 * 同じ月に複数あれば1つにまとめる（人が足したもの → 額の変化 → 遡及 の順に向きを採る）
 */
export function findStartMonths(
  payrolls: ReadonlyMap<string, Payroll>,
  wageChanges: readonly WageChange[] = [],
): StartMonth[] {
  const found = new Map<string, StartMonth>();
  const months = [...payrolls.keys()].sort();
  // 比べる相手は、前の月の実績。ただし固定的賃金が0円の月（休業中など）は飛ばして、最後に払った月と比べる
  // （育休明けに「0円 → 19万円で上がった」と読まないため。休業前の27万円 → 19万円なら「下がった」）
  let last: Payroll | null = null;
  for (const m of months) {
    const p = payrolls.get(m)!;
    const prev = payrolls.get(shiftMonth(m, -1));
    if (p.fixed > 0 && last && prev && p.fixed !== last.fixed) {
      found.set(m, { month: m, direction: p.fixed > last.fixed ? 'up' : 'down', source: 'fixed' });
    } else if (p.retro > 0) {
      found.set(m, { month: m, direction: 'up', source: 'retro' });
    }
    if (p.fixed > 0) last = p;
  }
  for (const w of wageChanges) {
    if (w.source === 'dismissed') found.delete(w.month);
    else found.set(w.month, { month: w.month, direction: w.direction, source: 'manual' });
  }
  return [...found.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export type IrregularStatus =
  | 'candidate' // 健保か厚年のどちらかで改定する
  | 'waiting' // 3か月の実績がまだそろっていない
  | 'shortDays' // 支払基礎日数が基準に届かない月がある
  | 'noGradeDiff' // 2等級差がない（特例にも当たらない）
  | 'opposite' // 固定的賃金の変わった向きと、等級の変わった向きが逆
  | 'noStandard'; // 今の標準報酬がない

export interface IrregularInput {
  start: StartMonth;
  payrolls: ReadonlyMap<string, Payroll>;
  remunerations: readonly Remuneration[];
  /** 改定する月に使う等級表 */
  gradesAt: (month: string) => GradeRows;
  /** その支払月の支払基礎日数の基準（給与計算期間の末日の区分から。minDaysOf） */
  minDaysAt: (paidMonth: string) => number;
  /** 改定する月に厚年の資格があるか（70歳以上などは健保だけ） */
  pensionAt: (month: string) => boolean;
}

export interface IrregularResult {
  start: StartMonth;
  status: IrregularStatus;
  months: RevisionMonth[];
  revisedFrom: string; // 起算月から4か月目
  average: Average | null;
  /** 従前の報酬月額（上限・下限の特例に使った値） */
  beforeAmount: number | null;
  health: InsuranceJudgement | null;
  pension: InsuranceJudgement | null;
  /** 年間平均の材料と判定（ふつうの候補のときだけ。そうでなければ null） */
  annual: IrregularAnnual | null;
}

// ===== 年間平均（保険者算定） =====

export type AnnualSkip = 'noRecord' | 'shortDays' | 'suspended';

export interface AnnualMonth {
  month: string;
  payroll: Payroll | null;
  used: boolean;
  skip: AnnualSkip | null;
  /** 3か月のほう（起算月から）か */
  inThree: boolean;
  /** 非固定的賃金（支払額 − 固定的賃金 − 遡及支払額。マイナスは0） */
  nonFixed: number;
}

export interface AnnualJudgement {
  /** 年間平均（B）の標準報酬 */
  b: StandardRemuneration;
  /** A の等級 − B の等級 */
  diffAB: number;
  /** 1等級差の例外（上限・下限の近く）で A と B の差を認めた */
  exception: boolean;
  /** 年間平均で決めたときに改定するか（B が今の等級から、変動の向きに動く） */
  revise: boolean;
}

export interface IrregularAnnual {
  months: AnnualMonth[]; // 起算月の9か月前〜起算月から3か月（12か月）
  usedCount: number;
  /** 3か月のほかに数えられた月の数（1以上が要る） */
  outsideCount: number;
  fixedAverage: number; // 3か月の固定的賃金（＋現物）の平均
  nonFixedAverage: number; // 数えた月の非固定的賃金の平均
  average: number; // B
  health: AnnualJudgement;
  pension: AnnualJudgement | null;
  /** 年間平均の候補（健保か厚年で、A と B に2等級以上の差か例外） */
  candidate: boolean;
  /** 9か月のうち、実績が入っていない月がある */
  incomplete: boolean;
}

function annualMonthOf(month: string, payroll: Payroll | null, minDays: number, inThree: boolean): AnnualMonth {
  if (!payroll) return { month, payroll: null, used: false, skip: 'noRecord', inThree, nonFixed: 0 };
  const nonFixed = Math.max(0, payroll.cash - payroll.fixed - payroll.retro);
  const skip: AnnualSkip | null =
    payroll.state !== 'normal' ? 'suspended' : payroll.days < minDays ? 'shortDays' : null;
  return { month, payroll, used: skip === null, skip, inThree, nonFixed };
}

/**
 * 年間平均の判定（ふつうの随時改定の候補になったときに呼ぶ）
 * a：ふつうの平均（修正平均）、current：今の標準報酬、direction：固定的賃金の変わった向き
 */
export function judgeAnnualIrregular(x: {
  startMonth: string;
  direction: Direction;
  payrolls: ReadonlyMap<string, Payroll>;
  minDaysAt: (paidMonth: string) => number;
  rows: GradeRows;
  a: number;
  current: { health: StandardRemuneration; pension: StandardRemuneration };
  withPension: boolean;
}): IrregularAnnual | null {
  const months = Array.from({ length: 12 }, (_, i) => {
    const month = shiftMonth(x.startMonth, i - 9);
    return annualMonthOf(month, x.payrolls.get(month) ?? null, x.minDaysAt(month), i >= 9);
  });
  const three = months.filter((m) => m.inThree);
  if (three.some((m) => !m.payroll)) return null;
  const used = months.filter((m) => m.used);
  const outsideCount = used.filter((m) => !m.inThree).length;
  if (used.length === 0) return null;

  const fixedAverage = Math.floor(three.reduce((s, m) => s + m.payroll!.fixed + inKindYen(m.payroll!), 0) / 3);
  const nonFixedAverage = Math.floor(used.reduce((s, m) => s + m.nonFixed, 0) / used.length);
  const average = fixedAverage + nonFixedAverage;

  const judge = (kind: 'health' | 'pension'): AnnualJudgement => {
    const rows = x.rows[kind];
    const gA = gradeOf(rows, x.a).grade;
    const b = gradeOf(rows, average);
    const diffAB = gA - b.grade;
    const exception = Math.abs(diffAB) === 1 && oneGradeException(rows, x.a, average);
    const moved = b.grade - x.current[kind].grade;
    // Q16：昇給なのに B が今の等級以下（降給なのに以上）なら改定しない
    const revise = moved !== 0 && sameDirection(x.direction, moved);
    return { b, diffAB, exception, revise };
  };
  const health = judge('health');
  const pension = x.withPension ? judge('pension') : null;
  const meets = (j: AnnualJudgement | null) => !!j && (Math.abs(j.diffAB) >= 2 || j.exception);

  return {
    months,
    usedCount: used.length,
    outsideCount,
    fixedAverage,
    nonFixedAverage,
    average,
    health,
    pension,
    candidate: outsideCount >= 1 && (meets(health) || meets(pension)),
    incomplete: months.some((m) => !m.inThree && m.skip === 'noRecord'),
  };
}

/** 向きが合っているか（unclear は人が確かめる前提で通す） */
function sameDirection(direction: Direction, diff: number): boolean {
  if (direction === 'unclear' || diff === 0) return true;
  return direction === 'up' ? diff > 0 : diff < 0;
}

export function judgeIrregular(x: IrregularInput): IrregularResult {
  const s = x.start.month;
  const revisedFrom = shiftMonth(s, 3);
  const months: RevisionMonth[] = [0, 1, 2].map((i) => {
    const month = shiftMonth(s, i);
    const payroll = x.payrolls.get(month) ?? null;
    const minDays = x.minDaysAt(month);
    return {
      month,
      payroll,
      amount: payroll ? payTotal(payroll) : 0,
      minDays,
      used: !!payroll && payroll.days >= minDays,
    };
  });
  const base: IrregularResult = {
    start: x.start,
    status: 'waiting',
    months,
    revisedFrom,
    average: null,
    beforeAmount: null,
    health: null,
    pension: null,
    annual: null,
  };

  if (months.some((m) => !m.payroll)) return base;
  if (months.some((m) => !m.used)) return { ...base, status: 'shortDays' };

  const average = averageOfMonths(months)!;
  const current = standardAt(x.remunerations, shiftMonth(revisedFrom, -1));
  if (!current) return { ...base, status: 'noStandard', average };

  const amount = average.corrected;
  const rows = x.gradesAt(revisedFrom);
  const judge = (kind: 'health' | 'pension'): InsuranceJudgement => {
    const j = judgeOne(rows[kind], current[kind], amount);
    const special =
      Math.abs(j.diff) === 1 && oneGradeException(rows[kind], current.monthlyAmount, amount);
    const big = Math.abs(j.diff) >= 2 || special;
    return { ...j, special, revise: big && sameDirection(x.start.direction, j.diff) };
  };
  const health = judge('health');
  const pension = x.pensionAt(revisedFrom) ? judge('pension') : null;

  const judged = [health, pension].filter((j): j is InsuranceJudgement => j !== null);
  const status: IrregularStatus = judged.some((j) => j.revise)
    ? 'candidate'
    : judged.some((j) => Math.abs(j.diff) >= 2 || j.special)
      ? 'opposite'
      : 'noGradeDiff';
  const annual =
    status === 'candidate'
      ? judgeAnnualIrregular({
          startMonth: s,
          direction: x.start.direction,
          payrolls: x.payrolls,
          minDaysAt: x.minDaysAt,
          rows,
          a: amount,
          current: { health: current.health, pension: current.pension },
          withPension: pension !== null,
        })
      : null;
  return { ...base, status, average, beforeAmount: current.monthlyAmount, health, pension, annual };
}
