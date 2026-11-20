/**
 * 「賞与」と「賞与に係る報酬」の区分（年4回以上の賞与。11/19）
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 *
 * 根拠
 * - 健康保険法3条5項・6項、厚生年金保険法3条1項3号・4号（年3回以下は賞与、年4回以上は報酬）
 * - 昭和53年6月20日 保発第47号・庁保発第21号（局部長通知）1(1)・1(2)・2(1)〜(3)
 * - 平成30年7月30日 事務連絡、令和5年6月12日 事務連絡（Q&A）Q3・Q4・Q7・Q8
 *
 * 決まり（人ごと・性質ごと）
 * - 回数は、名称にかかわらず同じ性質の支給ごとに数える（性質は人が支給に付ける。初期値は「賞与」）
 * - 支給の間隔は見ない。回数だけで判断する（Q7）
 * - 例外的な分割の2回目以降は1回にまとめる（数えない。額は足す）。その年に限りの支給は数えない（額も足さない。賞与のまま）
 * - 月 M に払った支給は、「その時点で適用されている定時決定の年 Y」で区分する
 *   （9〜12月なら M の年、1〜8月なら前の年）。Y年7月1日前の1年に、同じ性質の支給を4回以上受けていれば「賞与に係る報酬」
 *   → 規程を新しく作った年は実績がないので賞与のまま（Q4）、実績が3回以下なら翌年度も賞与（Q8）
 * - 定時決定（Y）では、Y年7月1日前の1年に受けた「報酬に当たる性質」の支給の合計 ÷ 12 を報酬月額に足す
 *   （年の途中で規程を変えた人の「受けたであろう額」は、定時決定の画面で年額を手で直す）
 *
 * 賞与の項目（bonus-items.ts。11/19）
 * - 項目に当たった支給は、項目ごとに数える（group）
 * - 扱い「年4回以上の賞与」：回数を待たずに報酬。最初の年で実績が規程の回数に足りなければ、平均 × 規程の回数を見込みにする
 * - 扱い「対象外」：賞与でも報酬でもない（保険料・賞与支払届・定時決定のどれにも入れない）
 */
import { DateStr } from '../../../shared/utils/date';
import { ItemRule, treatmentAt } from './bonus-items';

/** 性質の初期値 */
export const DEFAULT_NATURE = '賞与';

/** 回数の数え方：normal＝数える／split＝例外的な分割の続き（数えない・額は足す）／oneOff＝その年に限り（数えない・賞与のまま） */
export type BonusCountAs = 'normal' | 'split' | 'oneOff';
export const BONUS_COUNT_AS: readonly BonusCountAs[] = ['normal', 'split', 'oneOff'];

/** 区分に使う支給の形（BonusPayment をそのまま渡せる） */
export interface NaturePaymentLike {
  id: string;
  paidDate: DateStr;
  amounts: Record<string, number>;
  inKindAmounts?: Record<string, number>;
  nature?: string | null;
  countAs?: BonusCountAs | null;
  /** 当たった賞与の項目の名前（計算の前に付ける。保存しない） */
  group?: string;
  /** 当たった賞与の項目の決まり（同上） */
  rule?: ItemRule;
}

/** 4回以上で「賞与に係る報酬」 */
export const REMUNERATION_COUNT = 4;

export function natureOf(p: Pick<NaturePaymentLike, 'nature' | 'group'>): string {
  return p.group ?? (p.nature?.trim() || DEFAULT_NATURE);
}

/** 社会保険の対象外の項目の支給か（賞与でも報酬でもない） */
export function isNotCovered(p: Pick<NaturePaymentLike, 'paidDate' | 'rule'>): boolean {
  return treatmentAt(p.rule, periodYearOf(p.paidDate)) === 'none';
}

function countAsOf(p: Pick<NaturePaymentLike, 'countAs'>): BonusCountAs {
  return p.countAs ?? 'normal';
}

/** その支払日に適用されている定時決定の年（9〜12月はその年、1〜8月は前の年） */
export function periodYearOf(paidDate: DateStr): number {
  const y = Number(paidDate.slice(0, 4));
  return Number(paidDate.slice(5, 7)) >= 9 ? y : y - 1;
}

/** Y年7月1日前の1年（前年7/1〜当年6/30） */
export function windowOf(year: number): { from: DateStr; to: DateStr } {
  return { from: `${year - 1}-07-01`, to: `${year}-06-30` };
}

/**
 * その人の賞与額＝通貨＋現物（11/20）
 * 現物で払った賞与も標準賞与額の対象（健保法45条・厚年法24条の4。賞与支払届の「通貨」「現物」の合計）
 * 計算・回数・人数はすべてこの額で見る（現物だけの支給も「払った」）
 */
export function bonusTotalOf(p: Pick<NaturePaymentLike, 'amounts' | 'inKindAmounts'>, employeeId: string): number {
  const cash = p.amounts[employeeId] ?? 0;
  const inKind = p.inKindAmounts?.[employeeId] ?? 0;
  return (cash > 0 ? cash : 0) + (inKind > 0 ? inKind : 0);
}

/** 支給を受けた人（通貨か現物のどちらかが 0 円より多い） */
export function recipientsOf(p: Pick<NaturePaymentLike, 'amounts' | 'inKindAmounts'>): string[] {
  return [...new Set([...Object.keys(p.amounts), ...Object.keys(p.inKindAmounts ?? {})])].filter((id) => bonusTotalOf(p, id) > 0);
}

const paidTo = (employeeId: string, p: NaturePaymentLike) => bonusTotalOf(p, employeeId) > 0;
const inWindow = (p: NaturePaymentLike, w: { from: DateStr; to: DateStr }) => p.paidDate >= w.from && p.paidDate <= w.to;

/** Y年7月1日前の1年に、その人がその性質の支給を受けた回数（分割の続き・その年限りは数えない） */
export function countOf(employeeId: string, nature: string, year: number, payments: readonly NaturePaymentLike[]): number {
  const w = windowOf(year);
  return payments.filter(
    (p) => paidTo(employeeId, p) && natureOf(p) === nature && countAsOf(p) === 'normal' && inWindow(p, w),
  ).length;
}

/** その人のその支給は「賞与に係る報酬」か（賞与の保険料・賞与支払届の対象外） */
export function isRemunerationBonus(
  employeeId: string,
  payment: NaturePaymentLike,
  payments: readonly NaturePaymentLike[],
): boolean {
  if (!paidTo(employeeId, payment) || countAsOf(payment) === 'oneOff') return false;
  const treatment = treatmentAt(payment.rule, periodYearOf(payment.paidDate));
  if (treatment === 'none') return false;
  if (treatment === 'remuneration') return true;
  return countOf(employeeId, natureOf(payment), periodYearOf(payment.paidDate), payments) >= REMUNERATION_COUNT;
}

export interface NatureTotal {
  nature: string;
  count: number; // 数えた回数
  total: number; // 額（通貨＋現物。分割の続きを含む。見込みのときは見込みの額）
  /** 年4回以上の賞与で、実績が規程の回数に足りないので「平均 × 規程の回数」にした（11/19） */
  estimated?: boolean;
}

export interface BonusRemuneration {
  year: number;
  /** 報酬に当たる性質ごとの回数と額（4回以上のものだけ） */
  natures: NatureTotal[];
  /** 7月1日前の1年に受けた額の合計 */
  annual: number;
  /** 合計 ÷ 12（1円未満切り捨て）：報酬月額に足す額 */
  monthly: number;
  /** 足した支給を払った月（支払日の順。算定基礎届の備考「賞与 9.12.3.6月 75,000円」に書く。11/19） */
  months: number[];
}

/**
 * 定時決定（Y）で報酬月額に足す「賞与に係る報酬」
 * enrolledFrom：その人が被保険者になった日（11/19）。7月1日前の1年の途中から入った人は、
 * 規程を変えた年でも「受けたであろう額」にせず、実際に受けた額 ÷ 12 にする（局部長通知 2(1)ア）
 */
export function bonusRemunerationOf(
  employeeId: string,
  year: number,
  payments: readonly NaturePaymentLike[],
  enrolledFrom: DateStr | null = null,
): BonusRemuneration {
  const w = windowOf(year);
  const wholeYear = !enrolledFrom || enrolledFrom <= w.from;
  const byNature = new Map<string, NatureTotal>();
  const forced = new Map<string, number | null>(); // 扱いが「年4回以上の賞与」のまとまり → 規程の回数
  for (const p of payments) {
    if (!paidTo(employeeId, p) || !inWindow(p, w) || countAsOf(p) === 'oneOff') continue;
    const treatment = treatmentAt(p.rule, year);
    if (treatment === 'none') continue;
    const n = natureOf(p);
    // 見込み（受けたであろう額）は、規程を変えてこの年から報酬になった項目で、1年まるごと被保険者だった人だけ
    // （規程がずっと続いている項目・途中で入った人は、実際に受けた額 ÷ 12。局部長通知 2(1)ア・イ。11/19）
    if (treatment === 'remuneration') {
      const changedThisYear = treatmentAt(p.rule, year - 1) !== 'remuneration';
      forced.set(n, changedThisYear && wholeYear ? (p.rule?.plannedCount ?? null) : null);
    }
    const t = byNature.get(n) ?? { nature: n, count: 0, total: 0 };
    if (countAsOf(p) === 'normal') t.count++;
    t.total += bonusTotalOf(p, employeeId);
    byNature.set(n, t);
  }
  const natures = [...byNature.values()]
    .filter((t) => t.count >= REMUNERATION_COUNT || forced.has(t.nature))
    .map((t) => {
      const planned = forced.get(t.nature);
      return planned && t.count > 0 && t.count < planned
        ? { ...t, total: Math.floor((t.total * planned) / t.count), estimated: true }
        : t;
    })
    .sort((a, b) => a.nature.localeCompare(b.nature, 'ja'));
  const annual = natures.reduce((s, t) => s + t.total, 0);
  const counted = new Set(natures.map((t) => t.nature));
  const months = payments
    .filter(
      (p) =>
        paidTo(employeeId, p) &&
        inWindow(p, w) &&
        countAsOf(p) !== 'oneOff' &&
        treatmentAt(p.rule, year) !== 'none' &&
        counted.has(natureOf(p)),
    )
    .map((p) => p.paidDate)
    .sort()
    .map((d) => Number(d.slice(5, 7)));
  return { year, natures, annual, monthly: monthlyOf(annual), months: [...new Set(months)] };
}

/** 被保険者になった日（健保と厚年の早いほう。どちらもなければ null）：bonusRemunerationOf の enrolledFrom に渡す（11/19） */
export function enrolledFromOf(e: {
  health: { acquiredDate: DateStr | null };
  pension: { acquiredDate: DateStr | null };
}): DateStr | null {
  const ds = [e.health.acquiredDate, e.pension.acquiredDate].filter((d): d is DateStr => !!d).sort();
  return ds[0] ?? null;
}

/** 年額 ÷ 12（1円未満切り捨て） */
export function monthlyOf(annual: number): number {
  return Math.floor(Math.max(0, annual) / 12);
}

/**
 * 随時改定で足す額の年（11/19）
 * 7〜9月の改定はその年の定時決定と同じ計算（局部長通知 2(1)）、それ以外は直前の定時決定の額（2(3)）
 * → 改定する月が7月以降ならその年、1〜6月なら前の年
 */
export function irregularBonusYearOf(revisedFrom: string): number {
  const y = Number(revisedFrom.slice(0, 4));
  return Number(revisedFrom.slice(5, 7)) >= 7 ? y : y - 1;
}

/** 資格取得時の賞与に係る報酬（局部長通知 2(2)。11/19） */
export interface AcquireBonusRemuneration {
  /** 平均（1円未満切り捨て）。報酬月額に足す額 */
  monthly: number;
  /** 平均に使った人数 */
  people: number;
  /** 報酬になっている賞与の項目（性質）の名前 */
  natures: string[];
}

/**
 * 資格取得時の賞与に係る報酬：同様の業務に従事し、同様の賞与を受ける者の賞与に係る報酬の平均
 * - 取得日に効いている定時決定の年（periodYearOf）で、賞与に係る報酬がある人（本人以外）の月額の平均
 * - 「同様の業務」はアプリでは決められないので、画面で直してもらう（ここでは同じ事業所の全員の平均を初期値にする）
 * - 該当する人がいなければ null
 */
export function acquireBonusRemunerationOf(
  employeeId: string,
  acquiredDate: DateStr,
  others: readonly { id: string; health: { acquiredDate: DateStr | null }; pension: { acquiredDate: DateStr | null } }[],
  payments: readonly NaturePaymentLike[],
): AcquireBonusRemuneration | null {
  const year = periodYearOf(acquiredDate);
  const list = others
    .filter((o) => o.id !== employeeId)
    .map((o) => bonusRemunerationOf(o.id, year, payments, enrolledFromOf(o)))
    .filter((r) => r.monthly > 0);
  if (list.length === 0) return null;
  return {
    monthly: Math.floor(list.reduce((s, r) => s + r.monthly, 0) / list.length),
    people: list.length,
    natures: [...new Set(list.flatMap((r) => r.natures.map((n) => n.nature)))].sort((a, b) => a.localeCompare(b, 'ja')),
  };
}
