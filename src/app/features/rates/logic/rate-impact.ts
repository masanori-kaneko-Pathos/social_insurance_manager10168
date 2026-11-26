/**
 * 組合の料率を入れ直したときの影響（11/26）
 * - 保存の前と後で、月ごとに効いている料率（健保・介護・支援金の本人分・会社分）を比べる
 * - 違う月を、続いた範囲ごとにまとめる。そのうち確認済みにした月（monthCloses）も数える
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 */
import { KumiaiRateInput, MonthRange, RateSplit } from '../../../core/models/rates';
import { monthsBetween, shiftMonth } from '../../../shared/utils/date';
import { inRange } from './rate-changes';
import { latest } from './pick-rates';

/** 続いた月の範囲（to を含む。to が null なら、期間の終わりまで続く） */
export interface MonthSpan {
  from: string;
  to: string | null;
}

export interface RateImpact {
  /** 計算が変わる月 */
  changed: MonthSpan[];
  /** 変わる月の数（期間の終わりまで続くときは数えられないので null） */
  changedCount: number | null;
  /** そのうち確認済みの月（古い順） */
  closed: string[];
}

function sameSplit(a: RateSplit | undefined, b: RateSplit | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.employee === b.employee && a.employer === b.employer;
}

function sameRate(a: KumiaiRateInput | null, b: KumiaiRateInput | null): boolean {
  if (!a || !b) return !a && !b;
  return (
    sameSplit(a.health, b.health) &&
    sameSplit(a.care, b.care) &&
    sameSplit(a.childSupport, b.childSupport)
  );
}

/** 保存したあとの料率の一覧（同じ月は置き換え、remove の月は消す） */
export function applyRates(
  before: readonly KumiaiRateInput[],
  save: readonly KumiaiRateInput[],
  remove: readonly string[] = [],
): KumiaiRateInput[] {
  const map = new Map(before.map((k) => [k.from, k]));
  for (const m of remove) map.delete(m);
  for (const k of save) map.set(k.from, k);
  return [...map.values()];
}

/** 月の並びを、続いた範囲にまとめる（並びは古い順） */
export function spansOf(months: readonly string[]): MonthSpan[] {
  const out: MonthSpan[] = [];
  for (const m of months) {
    const last = out[out.length - 1];
    if (last && last.to !== null && shiftMonth(last.to, 1) === m) last.to = m;
    else out.push({ from: m, to: m });
  }
  return out;
}

/**
 * 保存の前（before）と後（after）で、この組合の期間（range）の中で計算が変わる月
 * - 料率は「その月以前で一番新しい行」が効く。期間より前の行は別の組合のものなので使わない（pickRates と同じ）
 * - 一番新しい行より後は、もう何も変わらない。だから最後の行の月まで比べれば、その先は最後の月と同じ
 * - 料率がない月（計算できなかった月）に料率が入るのも「変わる」に数える
 */
export function rateImpact(
  before: readonly KumiaiRateInput[],
  after: readonly KumiaiRateInput[],
  range: MonthRange,
  closedMonths: readonly string[],
): RateImpact {
  const own = (list: readonly KumiaiRateInput[]) => list.filter((k) => inRange(k.from, range));
  const b = own(before);
  const a = own(after);
  const froms = [...new Set([...b, ...a].map((k) => k.from))].sort();
  // 違いが出うるのは、どちらかにしかない行・値が違う行の月から
  const touched = froms.filter(
    (m) => !sameRate(b.find((k) => k.from === m) ?? null, a.find((k) => k.from === m) ?? null),
  );
  if (touched.length === 0) return { changed: [], changedCount: 0, closed: [] };

  const start = touched[0];
  const end = froms[froms.length - 1];
  const differs = (m: string) => !sameRate(latest(b, m), latest(a, m));
  const months = monthsBetween(start, end).filter(differs);
  const changed = spansOf(months);

  // 最後の行の月が違えば、期間の終わりまで同じ違いが続く
  const lastMonth = range.to ? shiftMonth(range.to, -1) : null;
  const tail = changed[changed.length - 1];
  if (tail && tail.to === end && end !== lastMonth) tail.to = lastMonth;

  const isChanged = (m: string) => changed.some((s) => m >= s.from && (s.to === null || m <= s.to));
  const closed = [...new Set(closedMonths)].filter(isChanged).sort();
  const open = changed.some((s) => s.to === null);
  const changedCount = open
    ? null
    : changed.reduce((n, s) => n + monthsBetween(s.from, s.to!).length, 0);
  return { changed, changedCount, closed };
}

/** 影響を調べる最初の月（確認済みの月をここから読む）。変わる行がなければ null */
export function impactStart(
  before: readonly KumiaiRateInput[],
  save: readonly KumiaiRateInput[],
  remove: readonly string[] = [],
): string | null {
  const touched = [...save.map((k) => k.from), ...remove].filter((m) => {
    const prev = before.find((k) => k.from === m) ?? null;
    const next = save.find((k) => k.from === m) ?? null;
    return !sameRate(prev, next);
  });
  return touched.length ? [...touched].sort()[0] : null;
}
