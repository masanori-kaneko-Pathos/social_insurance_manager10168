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

import { fixedForChange, inKindYen, payTotal, type Payroll } from '../../../core/models/payroll';
import type { WageChange } from '../../../core/models/revision';
import type { PayType } from '../../../core/models/contract';
import type { StandardRemuneration } from '../../../core/models/remuneration';
import { shiftMonth } from '../../../shared/utils/date';
import { gradeOf } from '../../rates/logic/grade';
import { oneGradeException, GradeRows, Remuneration } from './regular';
import { bonusCarry, forWindow } from './spread';
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
  /**
   * fixed：固定的賃金の額が変わった／retro：遡及支払がある／manual：人が足した／furlough：一時帰休の始まり・終わり（11/19）
   * inKind：現物給与（社宅・食事など）の額が変わった。入居・退去、本人負担の変更、価額の改正（11/24）
   * contract：雇用契約の時給・日給・所定労働時間・給与の形が変わった（11/24）
   */
  source: 'fixed' | 'retro' | 'manual' | 'furlough' | 'contract' | 'inKind';
}

/** 雇用契約の変更から起算月を出すときの、契約の形（11/24） */
export interface ContractLike {
  from: string;
  payType: PayType;
  hourlyWage: number | null;
  dailyWage: number | null;
  weeklyMinutes: number;
}

/**
 * 雇用契約の変更から、随時改定の起算月を出す（11/24）
 * 時給・日給の人は、働いた時間で給与の額が動くので、額の比較では固定的賃金の変動を見つけられない。代わりに契約を見る：
 * - 時給・日給（単価）が変わった（事例集「時給単価の変更」）
 * - 所定労働時間が変わった（時給は同じでも、契約時間の変更は固定的賃金の変動。事例集 問1-3）
 * - 給与の形が変わった（日給から月給へ など。給与体系の変更）
 * 起算月は、新しい契約で1か月分そろった最初の支払月（計算期間の初日が、新しい契約の開始日以後の月）
 * periodStart：支払月 → その計算期間の初日
 */
export function contractStartMonths(
  contracts: readonly ContractLike[],
  periodStart: (paidMonth: string) => string,
): StartMonth[] {
  const list = [...contracts].sort((a, b) => a.from.localeCompare(b.from));
  const out: StartMonth[] = [];
  const unit = (c: ContractLike) => (c.payType === 'hourly' ? c.hourlyWage : c.payType === 'daily' ? c.dailyWage : null);
  const byUnit = (c: ContractLike) => c.payType === 'hourly' || c.payType === 'daily';
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    if (!byUnit(a) && !byUnit(b)) continue; // 月給どうしは給与の額で見つけられる
    let direction: Direction | null = null;
    if (a.payType !== b.payType) direction = 'unclear';
    else if ((unit(a) ?? 0) !== (unit(b) ?? 0)) direction = (unit(b) ?? 0) > (unit(a) ?? 0) ? 'up' : 'down';
    else if (a.weeklyMinutes !== b.weeklyMinutes) direction = b.weeklyMinutes > a.weeklyMinutes ? 'up' : 'down';
    if (!direction) continue;
    // 新しい契約の開始日を含む支払月から数えて、計算期間の初日が開始日以後になる最初の月
    let m = b.from.slice(0, 7);
    for (let k = 0; k < 3 && periodStart(m) < b.from; k++) m = shiftMonth(m, 1);
    out.push({ month: m, direction, source: 'contract' });
  }
  return out;
}

/**
 * 起算月の候補を出す
 * - 給与の実績の fixed（固定的賃金）が、前の月の実績と変わった月（前の月が0円なら、最後に払った月と比べる）
 * - 遡及支払額（retro）がある月（さかのぼった昇給の差額を払った月。26ページの記入例）
 * - 現物給与（inKind）の額が、前の月の実績と変わった月（11/24）
 *   現物給与は固定的賃金。価額の改正も固定的賃金の変動に当たる（日本年金機構「現物給与の価額 Q&A」Q3）
 *   入居・退去の月は日割りなので（同 Q7）、その月の額が前後の月の間にあれば日割りの月とみなし、次の月を起算月にする（事例7と同じ）
 *   現物の内訳なし（null：給与ソフトが支払額に足している）の月とは比べない（人が足す）
 * - wageChanges で人が足した月（manual）を足し、外した月（dismissed）を除く
 * 同じ月に複数あれば1つにまとめる（人が足したもの → 額の変化 → 遡及 の順に向きを採る）
 */
export function findStartMonths(
  payrolls: ReadonlyMap<string, Payroll>,
  wageChanges: readonly WageChange[] = [],
  opts: {
    /**
     * その支払月の固定的賃金を、額で比べてよいか（11/24）。時給・日給の人の内訳なしの月は、固定的賃金に
     * 時給×時間が入っていて働いた時間で動くので、額では比べない（契約の変更 contractStarts で見つける）
     */
    amountComparable?: (paidMonth: string) => boolean;
    /** 雇用契約の変更から出した起算月（contractStartMonths） */
    contractStarts?: readonly StartMonth[];
    /**
     * その支払月の支払基礎日数の基準（11/25）。基準に届かない月（締め日の変更で期間が短い月など）の次の月は、
     * その月の額と、その前の月の額のどちらかと同じなら変動にしない（事務取扱いの事例集 随時改定 問7：
     * 締め日を変えた月の次の月を起算月にはしない）。省くと見ない
     */
    minDaysAt?: (paidMonth: string) => number;
    /**
     * その支払月の計算期間が、産休・育休などの休業にかかっているか（11/25）。かかっている月は休職の月と同じく
     * 起算月にも比べる相手にもしない（休業中に通勤手当を払わないのは、賃金体系の変更ではない。事務取扱いの事例集 随時改定 問14）
     */
    leaveAt?: (paidMonth: string) => boolean;
  } = {},
): StartMonth[] {
  const found = new Map<string, StartMonth>();
  const months = [...payrolls.keys()].sort();
  // 比べる相手は、前の月の実績。ただし固定的賃金が0円の月（休業中など）は飛ばして、最後に払った月と比べる
  // （育休明けに「0円 → 19万円で上がった」と読まないため。休業前の27万円 → 19万円なら「下がった」）
  let last: Payroll | null = null;
  // 日数が基準に届かない月が続く前の、最後に払った月（問7。11/25）
  let beforeShort: Payroll | null = null;
  // 現物給与の比べる相手（前の月の現物の額。内訳なしの月・休職・一時帰休の月は飛ばす。11/24）
  let lastKind: number | null = null;
  const furlough = (m: string) => payrolls.get(m)?.state === 'furlough';
  for (const m of months) {
    const p = payrolls.get(m)!;
    const prev = payrolls.get(shiftMonth(m, -1));
    // 一時帰休（低額な休業手当）：始まった月から、3か月を超えて続いたら（4か月目の初めも一時帰休なら）候補
    // 終わって通常の報酬に戻った月も候補。一時帰休の間の固定的賃金の変動は、戻った月から数える
    // （日本年金機構「標準報酬月額の定時決定及び随時改定の事務取扱いに関する事例集」5(2) 問1・2・5・6。11/19）
    // 休職（休職給）の月は起算月にしない。休職中に固定的賃金が変わったら、戻った月を起算月にする（事例集 4 問8。11/19）
    // → 休職の月は「最後に払った月」にも入れず、戻った月を休職の前の月と比べる
    if (p.state === 'suspended' || opts.leaveAt?.(m)) continue;
    if (furlough(m)) {
      if (!furlough(shiftMonth(m, -1)) && [1, 2, 3].every((i) => furlough(shiftMonth(m, i)))) {
        found.set(m, { month: m, direction: 'down', source: 'furlough' });
      }
      continue;
    }
    if (prev && furlough(shiftMonth(m, -1))) {
      // 一時帰休の間に固定的賃金が変わっていれば、戻った月をその変動の起算月にする（疑義照会回答 28 の②）
      // 変わっていなければ「解消」の候補（休業手当で改定していたときだけ随時改定になる：furloughEndAllowed）
      const changed = !!last && fixedForChange(p) > 0 && fixedForChange(p) !== fixedForChange(last);
      found.set(m, changed ? { month: m, direction: directionOf(last!, p, false), source: 'fixed' } : { month: m, direction: 'up', source: 'furlough' });
      if (fixedForChange(p) > 0) last = p;
      continue;
    }
    // 現物給与が変わったか（前の月にも実績があり、どちらも現物の額が分かっているとき）
    const kind = p.inKind ?? null;
    const kindChanged = !!prev && kind !== null && lastKind !== null && kind !== lastKind;
    const kindDiff = kindChanged ? kind! - lastKind! : 0;
    // 現物の日割りの月：この月の額が、前の月と次の月の額の間にある（入居・退去の月。Q7）
    const nextKind = payrolls.get(shiftMonth(m, 1))?.inKind ?? null;
    const kindProrated =
      kindChanged && nextKind !== null && nextKind !== kind! &&
      Math.min(lastKind!, nextKind) < kind! && kind! < Math.max(lastKind!, nextKind);
    if (kind !== null) lastKind = kind;
    // 日割りの月（計算期間の途中で変わった月）は起算月にしない。1か月分そろった次の月を起算月にする（事例7。11/19）
    const at = p.prorated || kindProrated ? shiftMonth(m, 1) : m;
    // 額で比べられない月（時給・日給の人の内訳なしの月）は飛ばし、比べる相手もいったん空にする（11/24）
    // 内訳のある月は、時給×時間を除いた額（fixedFull）で比べられる
    if (p.fixedFull === null && opts.amountComparable && !opts.amountComparable(m)) {
      // 時給・日給の人でも、現物給与の変化は額で比べられる（社宅への入居など。契約は変わらない）
      if (kindChanged) found.set(at, { month: at, direction: kindDiff > 0 ? 'up' : 'down', source: 'inKind' });
      else if (p.retro > 0) found.set(at, { month: at, direction: 'up', source: 'retro' });
      last = null;
      continue;
    }
    // 比べるのは欠勤控除を引く前の額（内訳がある月。欠勤の月を変動と見ないため。11/24）
    // 日数が基準に届かない月の次の月：その前の月と同じ額に戻っただけなら変動ではない（問7。11/25）
    const backToBefore = !!beforeShort && fixedForChange(p) === fixedForChange(beforeShort);
    const fixedChanged = fixedForChange(p) > 0 && !!last && !!prev && fixedForChange(p) !== fixedForChange(last) && !backToBefore;
    if (fixedChanged && !kindChanged) {
      found.set(at, { month: at, direction: directionOf(last!, p, last === prev), source: 'fixed' });
    } else if (kindChanged) {
      // 現物給与も固定的賃金なので、向きは通貨の固定的賃金と現物の変化を合わせて決める（打ち消し合えば要確認）
      const total = kindDiff + (fixedChanged ? fixedForChange(p) - fixedForChange(last!) : 0);
      found.set(at, {
        month: at,
        direction: total > 0 ? 'up' : total < 0 ? 'down' : 'unclear',
        source: fixedChanged ? 'fixed' : 'inKind',
      });
    } else if (p.retro > 0) {
      found.set(at, { month: at, direction: 'up', source: 'retro' });
    }
    if (fixedForChange(p) > 0) {
      const short = !!opts.minDaysAt && p.days < opts.minDaysAt(m);
      if (!short) beforeShort = null;
      else if (!beforeShort) beforeShort = last;
      last = p;
    }
  }
  // 契約の変更は、額の変化より先に採る（向きが契約ではっきりしているため）
  for (const c of opts.contractStarts ?? []) found.set(c.month, c);
  for (const w of wageChanges) {
    if (w.source === 'dismissed') found.delete(w.month);
    else found.set(w.month, { month: w.month, direction: w.direction, source: 'manual' });
  }
  return [...found.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * 非固定的賃金（通貨によるものの額 − 固定的賃金 − 遡及支払額）
 * 現物は固定的賃金の側なので入れない（年間平均の判定と同じ。11/24 に payTotal から直した）
 */
function nonFixedOf(p: Payroll): number {
  return Math.max(0, p.cash - p.fixed - p.retro);
}

/**
 * 固定的賃金が変わった向き
 * 前の月から、固定的賃金が上がって非固定的賃金（時間外手当など）が0円になったときは unclear（向きは要確認）
 * - 管理職になって時間外手当を廃止したなら、増減の関連がはっきりしないので上下どちらも対象（調査指摘事例集 事例6・事例集 4 問5）
 * - たまたま0円だっただけなら、平均が逆向きに動いた改定は対象外（事例集 4 問4）
 * 額だけでは見分けられないので、候補には出して、画面の説明で人に決めてもらう（11/19）
 * 逆（固定的賃金が下がって変動的な手当が新しく出た）は、ふつうの残業が出ただけと見分けられないので、人が足す
 */
function directionOf(before: Payroll, after: Payroll, adjacent: boolean): Direction {
  const up = fixedForChange(after) > fixedForChange(before);
  if (up && adjacent && nonFixedOf(before) > 0 && nonFixedOf(after) === 0) return 'unclear';
  return up ? 'up' : 'down';
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
  /** 賞与に係る報酬（年4回以上の賞与の 年額÷12）。各月の報酬に足す。省くと 0（局部長通知 2(1)・2(3)。11/19） */
  bonusMonthly?: number;
  /**
   * 賞与に係る報酬の円未満（年額 ÷ 12 の余り。0〜11）。定期代の月割りの円未満と合わせて切り捨てる（月額変更届 15 の 2。11/26）
   * 省くと 0（賞与に係る報酬を手で直した月など、年額が分からないとき）
   */
  bonusRest?: number;
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
  const list = Array.from({ length: 12 }, (_, i) => shiftMonth(x.startMonth, i - 9));
  // まとめて払った定期代の全部が12か月に入るときは、総額が変わらないように割り振る（月額変更届 15。11/26）
  const pays = forWindow(x.payrolls, list);
  const months = list.map((month, i) => annualMonthOf(month, pays.get(month) ?? null, x.minDaysAt(month), i >= 9));
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
  // まとめて払った定期代の全部が3か月に入るときは、総額が変わらないように割り振る（月額変更届 15。11/26）
  const window = [0, 1, 2].map((i) => shiftMonth(s, i));
  const pays = forWindow(x.payrolls, window);
  const months: RevisionMonth[] = [0, 1, 2].map((i) => {
    const month = shiftMonth(s, i);
    const payroll = pays.get(month) ?? null;
    const minDays = x.minDaysAt(month);
    return {
      month,
      payroll,
      // 賞与に係る報酬は各月の報酬に足す（賞与の額が変わっただけでは随時改定の起算にならない。11/19）
      // 賞与に係る報酬の円未満と、定期代の月割りの円未満は、合わせて切り捨てる（月額変更届 15 の 2。11/26）
      amount: payroll ? payTotal(payroll) + (x.bonusMonthly ?? 0) + bonusCarry(x.payrolls, month, window, x.bonusRest ?? 0) : 0,
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

/**
 * 一時帰休が解消した月を、随時改定の起算月にしてよいか（11/26）
 * 疑義照会回答（月額変更届 25・28）：解消による随時改定は「休業手当等をもって標準報酬の決定又は改定を行った後に、
 * 一時帰休の状況が解消したとき」に限る。休業手当で決めた・改定した標準報酬がなければ、解消して報酬が上がっても随時改定にしない
 * 休業手当で決めた・改定したとみるもの（一時帰休が始まった月より後に始まる標準報酬）
 * - 随時改定：一時帰休が始まった月を起算月とした改定（4か月目から）
 * - 定時決定：4〜6月のどれかが一時帰休の月（7/1までに解消していなかった）
 * - 資格取得時の決定：一時帰休の間に資格を取った（入社した当初から一時帰休。算定基礎届 2）
 */
export function furloughEndAllowed(
  month: string,
  payrolls: ReadonlyMap<string, Pick<Payroll, 'state'>>,
  remunerations: readonly Pick<Remuneration, 'from' | 'reason'>[],
): boolean {
  const furlough = (m: string) => payrolls.get(m)?.state === 'furlough';
  if (!furlough(shiftMonth(month, -1))) return false;
  // 一時帰休が始まった月（続いている月を前へたどる）
  let start = shiftMonth(month, -1);
  while (furlough(shiftMonth(start, -1))) start = shiftMonth(start, -1);
  return remunerations.some((r) => {
    if (r.from <= start || r.from > month) return false;
    if (r.reason === 'irregular') return r.from === shiftMonth(start, 3);
    if (r.reason === 'regular') {
      const y = r.from.slice(0, 4);
      return ['04', '05', '06'].some((mm) => furlough(`${y}-${mm}`));
    }
    return r.reason === 'acquisition';
  });
}
