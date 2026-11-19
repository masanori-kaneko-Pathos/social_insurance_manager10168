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
 */
import { DateStr } from '../../../shared/utils/date';

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
}

/** 4回以上で「賞与に係る報酬」 */
export const REMUNERATION_COUNT = 4;

export function natureOf(p: Pick<NaturePaymentLike, 'nature'>): string {
  return p.nature?.trim() || DEFAULT_NATURE;
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

const paidTo = (employeeId: string, p: NaturePaymentLike) => (p.amounts[employeeId] ?? 0) > 0;
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
  return countOf(employeeId, natureOf(payment), periodYearOf(payment.paidDate), payments) >= REMUNERATION_COUNT;
}

export interface NatureTotal {
  nature: string;
  count: number; // 数えた回数
  total: number; // 額（通貨＋現物。分割の続きを含む）
}

export interface BonusRemuneration {
  year: number;
  /** 報酬に当たる性質ごとの回数と額（4回以上のものだけ） */
  natures: NatureTotal[];
  /** 7月1日前の1年に受けた額の合計 */
  annual: number;
  /** 合計 ÷ 12（1円未満切り捨て）：報酬月額に足す額 */
  monthly: number;
}

/** 定時決定（Y）で報酬月額に足す「賞与に係る報酬」 */
export function bonusRemunerationOf(
  employeeId: string,
  year: number,
  payments: readonly NaturePaymentLike[],
): BonusRemuneration {
  const w = windowOf(year);
  const byNature = new Map<string, NatureTotal>();
  for (const p of payments) {
    if (!paidTo(employeeId, p) || !inWindow(p, w) || countAsOf(p) === 'oneOff') continue;
    const n = natureOf(p);
    const t = byNature.get(n) ?? { nature: n, count: 0, total: 0 };
    if (countAsOf(p) === 'normal') t.count++;
    t.total += (p.amounts[employeeId] ?? 0) + (p.inKindAmounts?.[employeeId] ?? 0);
    byNature.set(n, t);
  }
  const natures = [...byNature.values()]
    .filter((t) => t.count >= REMUNERATION_COUNT)
    .sort((a, b) => a.nature.localeCompare(b.nature, 'ja'));
  const annual = natures.reduce((s, t) => s + t.total, 0);
  return { year, natures, annual, monthly: monthlyOf(annual) };
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
