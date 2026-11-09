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

import type { Payroll } from '../../../core/models/payroll';
import type { WageChange } from '../../../core/models/revision';
import { shiftMonth } from '../../../shared/utils/date';
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
 * - 給与の実績の fixed（固定的賃金）が、前の月の実績と変わった月
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
  for (const m of months) {
    const p = payrolls.get(m)!;
    const prev = payrolls.get(shiftMonth(m, -1));
    if (prev && p.fixed !== prev.fixed) {
      found.set(m, { month: m, direction: p.fixed > prev.fixed ? 'up' : 'down', source: 'fixed' });
    } else if (p.retro > 0) {
      found.set(m, { month: m, direction: 'up', source: 'retro' });
    }
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
      amount: payroll ? payroll.cash + payroll.inKind : 0,
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
  return { ...base, status, average, beforeAmount: current.monthlyAmount, health, pension };
}
