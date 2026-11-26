// まとめて払った通勤手当（3か月・6か月分の定期代）を、各月の報酬に割り振る（11/26）
// Angular・Firebase に依存しない純粋な関数
//
// 決まり（日本年金機構「疑義照会回答（厚生年金保険 適用）」。台帳 R106）
// - 何か月分の定期代かで割った額を、各月の報酬に入れる（月額変更届 4。昭和27年12月4日保文発第7241号）
// - 割り振る月は、実際に支給した月から月数分（券面の期間ではない。月額変更届 4）。随時改定の起算月も支給した月（月額変更届 3）
// - 円未満の端数（月額変更届 15）
//   1. 各月に割った額の円未満は、切り捨ててよい
//   2. 端数の出る手当が複数あるときは、手当ごとに切り捨てず、端数のまま足して、その月の報酬を決めるときに切り捨てる
//   3. 定時決定・随時改定で、まとめて払った額が全部、平均を出す月（3か月・年間平均の12か月）の中に入るときは、
//      総額が変わらないようにし、余りは支給した月に入れる（例：4月に3か月分 10,000円 → 4月 3,334円・5月 3,333円・6月 3,333円）
//
// 保存する実績（cash・fixed）は、その月の行だけで決める（ほかの月を直しても、保存済みの値は変わらない）
// - cash ＝ 実際に払った額（まとめて払った額の全部）。給与の実績の画面・給与ソフトの支給総額と同じ
// - fixed・fixedFull ＝ この月の分（割った額の切り捨て）だけを入れる
// 定時決定・随時改定・届出では、allocateSpreads で前の月から割り振られる分を足し、forWindow で 3 のきまりを当てる

import type { Payroll, PayrollLine } from '../../../core/models/payroll';
import type { PayrollItemCategory } from '../../../core/models/payroll-item';
import { shiftMonth } from '../../../shared/utils/date';

/** 何か月分を持てる分類（定期代は通勤手当） */
export const SPREAD_CATEGORIES: readonly PayrollItemCategory[] = ['commute'];
/** 画面で選べる月数（1 ＝ この月の分） */
export const SPREAD_CHOICES: readonly number[] = [1, 3, 6];
/** 月数の上限（届出・定時決定の画面が読む前の月の数と合わせる。6か月分の定期まで） */
export const MAX_SPREAD_MONTHS = 6;

/** まとめて払った1行（支給した月・額・月数） */
export interface SpreadPart {
  paidMonth: string;
  name: string;
  amount: number;
  months: number;
}

/** 行の月数（まとめ払いでなければ 1） */
export function spreadMonthsOf(l: Pick<PayrollLine, 'category' | 'months' | 'forMonth'>): number {
  const n = l.months;
  if (!SPREAD_CATEGORIES.includes(l.category) || l.forMonth || typeof n !== 'number' || !Number.isInteger(n)) return 1;
  return n >= 2 && n <= MAX_SPREAD_MONTHS ? n : 1;
}

/** その月に払った、まとめ払いの行 */
export function partsOf(lines: readonly PayrollLine[] | null | undefined, paidMonth: string): SpreadPart[] {
  return (lines ?? []).flatMap((l) => {
    const months = spreadMonthsOf(l);
    return months > 1 ? [{ paidMonth, name: l.name, amount: l.amount, months }] : [];
  });
}

/** 割り振る最後の月 */
export function lastMonthOf(part: Pick<SpreadPart, 'paidMonth' | 'months'>): string {
  return shiftMonth(part.paidMonth, part.months - 1);
}

/** その月に割り振る分があるか（支給した月から月数分） */
export function covers(part: Pick<SpreadPart, 'paidMonth' | 'months'>, month: string): boolean {
  return month >= part.paidMonth && month <= lastMonthOf(part);
}

/** その月が何か月目か（支給した月 ＝ 1） */
export function nthMonthOf(part: Pick<SpreadPart, 'paidMonth'>, month: string): number {
  const [y1, m1] = part.paidMonth.split('-').map(Number);
  const [y2, m2] = month.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * 割った額を端数のまま足して、最後に切り捨てる（きまり 1・2）
 * 割り算をせず、月数の最小公倍数を分母にした整数で足す（42,340 ÷ 6 ＝ 7,056.66… を丸めずに持つ）
 */
export function floorSum(parts: readonly Pick<SpreadPart, 'amount' | 'months'>[]): number {
  if (parts.length === 0) return 0;
  const d = parts.reduce((acc, p) => (acc * p.months) / gcd(acc, p.months), 1);
  const num = parts.reduce((s, p) => s + p.amount * (d / p.months), 0);
  return Math.floor(num / d);
}

/** 総額を変えない割り振り（きまり 3）：割った額の切り捨て、余りは支給した月 */
export function wholeShare(part: Pick<SpreadPart, 'paidMonth' | 'amount' | 'months'>, month: string): number {
  if (!covers(part, month)) return 0;
  const each = Math.floor(part.amount / part.months);
  return month === part.paidMonth ? part.amount - each * (part.months - 1) : each;
}

/** その月にかかる、まとめ払いの行（その月とそれより前の月に払ったもの） */
export function partsCovering(payrolls: ReadonlyMap<string, Pick<Payroll, 'lines'>>, month: string): SpreadPart[] {
  const out: SpreadPart[] = [];
  for (const [m, p] of payrolls) {
    if (m > month) continue;
    for (const part of partsOf(p.lines, m)) if (covers(part, month)) out.push(part);
  }
  return out.sort((a, b) => a.paidMonth.localeCompare(b.paidMonth));
}

/** 前の月に払った分のうち、その月にかかるもの（その月の内訳に「月割り」として見せる） */
export function incomingParts(payrolls: ReadonlyMap<string, Pick<Payroll, 'lines'>>, month: string): SpreadPart[] {
  return partsCovering(payrolls, month).filter((p) => p.paidMonth < month);
}

/**
 * この月の固定的賃金に足す額（前の月から割り振られる分。11/26）
 * own はこの月に払ったまとめ払い（保存する fixed には floorSum(own) だけ入っている）
 */
export function incomingDelta(own: readonly SpreadPart[], incoming: readonly SpreadPart[]): number {
  return floorSum([...own, ...incoming]) - floorSum(own);
}

/**
 * まとめ払いを各月に割り振る（きまり 1・2）。payrolls は書き換えてよい写し（allocateOtherMonths の中から呼ぶ）
 * - 総支給額（cash）：まとめて払った額の全部 → その月の分（前の月から割り振られる分も足して、端数のまま足してから切り捨て）
 * - 固定的賃金（fixed・fixedFull）：その月の分だけ入っている → 前の月から割り振られる分も足す
 * - 割り振る月の実績がまだない（これから入力する月）ときは、その月の分は数えない
 * 戻り値：動いた額（支払月 → 増減。動いていない月は入れない）
 */
export function allocateSpreads(payrolls: Map<string, Payroll>): Map<string, number> {
  const moved = new Map<string, number>();
  for (const [t, p] of payrolls) {
    const all = partsCovering(payrolls, t);
    if (all.length === 0) continue;
    const own = all.filter((x) => x.paidMonth === t);
    const share = floorSum(all);
    const cashDelta = share - own.reduce((s, x) => s + x.amount, 0);
    const fixedDelta = share - floorSum(own);
    payrolls.set(t, {
      ...p,
      cash: p.cash + cashDelta,
      fixed: p.fixed + fixedDelta,
      fixedFull: p.fixedFull === null || p.fixedFull === undefined ? p.fixedFull : p.fixedFull + fixedDelta,
    });
    if (cashDelta !== 0) moved.set(t, cashDelta);
  }
  return moved;
}

/**
 * 平均を出す月（3か月・12か月）に当てる（きまり 3）。allocateSpreads のあとの実績を渡す
 * まとめて払った額の全部がこの月の中に入る行は、総額が変わらない割り振り（余りは支給した月）にする。
 * 一部だけ入る行は、端数のまま足して切り捨て（きまり 1・2）のまま
 */
export function forWindow(payrolls: ReadonlyMap<string, Payroll>, months: readonly string[]): ReadonlyMap<string, Payroll> {
  const inWindow = new Set(months);
  let out: Map<string, Payroll> | null = null;
  for (const t of months) {
    const p = payrolls.get(t);
    if (!p) continue;
    const all = partsCovering(payrolls, t);
    if (all.length === 0) continue;
    const whole = all.filter((x) => Array.from({ length: x.months }, (_, i) => shiftMonth(x.paidMonth, i)).every((m) => inWindow.has(m)));
    if (whole.length === 0) continue;
    const rest = all.filter((x) => !whole.includes(x));
    const diff = whole.reduce((s, x) => s + wholeShare(x, t), 0) + floorSum(rest) - floorSum(all);
    if (diff === 0) continue;
    out ??= new Map(payrolls);
    out.set(t, { ...p, cash: p.cash + diff });
  }
  return out ?? payrolls;
}
