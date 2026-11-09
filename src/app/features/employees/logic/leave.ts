/**
 * 産休・育休による保険料の免除（月額・賞与）
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 *
 * 月額（日本年金機構）
 * - 休業を始めた日の月 〜 終了日の翌日の月の前月 が免除
 * - 育休で、開始月と「終了日の翌日の月」が同じ（月の中で終わる）なら、
 *   その月に14日以上（休日を含む）休んでいれば免除（2022年10月1日以降に始まった育休だけ）
 *   出生時育休（産後パパ育休）も育休の一種として同じ決まり。休業中に働いた日は14日から除く
 *   同じ月の中で何回か取ったら日数を合計する（育児休業等取得者申出書の「C. 育休等取得内訳」）
 * 終わりの日は「実際の終了日、なければ終了予定日」。どちらもなければ「未定」
 * 介護休業・休職は免除なし（定時決定の備考・随時改定の材料として記録するだけ）
 * 賞与
 * - 産休：支払月が免除の月なら免除
 * - 育休：支払月が免除の月（＝月の末日を含む）で、かつ休業が連続して1か月を超えるときだけ免除
 *   （2022年10月1日以降に始まった育休。終了日が未定のときは「超える」とみなす）
 * 免除でも標準賞与額は決まり、健保の年度累計には入る（日本年金機構）
 */
import {
  addDays,
  DateStr,
  daysInclusive,
  shiftMonth,
  toYearMonth,
  YearMonth,
} from '../../../shared/utils/date';

import { LeaveKind } from '../../../core/models/employee';

export interface LeaveLike {
  kind: LeaveKind;
  start: DateStr;
  end: DateStr | null; // 実際の終了日
  plannedEnd?: DateStr | null; // 終了予定日
  /** 出生時育休：休業中に働いた日数（14日の数え方から除く） */
  workDays?: number | null;
}

/** 休業の記録を持つもの（Employee をそのまま渡せる） */
export interface LeaveHolder {
  leaves?: LeaveLike[];
}

/** 保険料の免除がある休業か（介護休業・休職は免除なし） */
export function isExemptKind(kind: LeaveKind): boolean {
  return kind === 'maternity' || kind === 'childcare' || kind === 'paternity';
}

/** 育休の決まり（同月14日・賞与の1か月超）を使う休業か（出生時育休も育休の一種） */
export function isChildcareKind(kind: LeaveKind): boolean {
  return kind === 'childcare' || kind === 'paternity';
}

/** 免除の計算に使う終わりの日（実際の終了日 → 終了予定日 → 未定は null） */
export function endOf(l: LeaveLike): DateStr | null {
  return l.end ?? l.plannedEnd ?? null;
}

/** 同月14日のルール・賞与の1か月超のルールが始まった日 */
export const RULE_2022_FROM = '2022-10-01';

/**
 * 開始日から「1か月」の期間の最後の日（民法の数え方：翌月の応当日の前日。応当日がなければ翌月の末日）
 * 1/15 → 2/14、1/31 → 2/28（平年）
 */
export function oneMonthEnd(start: DateStr): DateStr {
  const [y, m, d] = start.split('-').map(Number);
  const lastDayOfNext = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // 翌月の末日
  const toIso = (t: number) => new Date(t).toISOString().slice(0, 10);
  if (d <= lastDayOfNext) return toIso(Date.UTC(y, m, d) - 86_400_000);
  return toIso(Date.UTC(y, m, lastDayOfNext));
}

/** 1つの休業で、その月の月額が免除か */
export function leaveExemptsMonth(l: LeaveLike, month: YearMonth): boolean {
  if (!isExemptKind(l.kind)) return false;
  const startMonth = toYearMonth(l.start);
  if (month < startMonth) return false;
  const end = endOf(l);
  if (end === null) return true; // 未定：開始月から先はずっと
  if (end < l.start) return false;
  const nextMonth = toYearMonth(addDays(end, 1));
  if (month < nextMonth) return true;
  // 月の中で終わる育休：14日以上（休業中に働いた日は除く）なら開始月を免除
  return (
    isChildcareKind(l.kind) &&
    month === startMonth &&
    startMonth === nextMonth &&
    l.start >= RULE_2022_FROM &&
    daysInclusive(l.start, end) - (l.workDays ?? 0) >= 14
  );
}

/** その月の中で始まって終わる育休か（14日の数え方の対象） */
function withinMonth(l: LeaveLike, month: YearMonth): boolean {
  const end = endOf(l);
  return (
    isChildcareKind(l.kind) &&
    end !== null &&
    end >= l.start &&
    l.start >= RULE_2022_FROM &&
    toYearMonth(l.start) === month &&
    toYearMonth(addDays(end, 1)) === month
  );
}

/** その月の中で始まって終わる育休の日数の合計（就業予定日数を除く）。届書の「取得日数 − 就業予定日数」 */
export function sameMonthDays(leaves: LeaveLike[] | undefined, month: YearMonth): number {
  return (leaves ?? [])
    .filter((l) => withinMonth(l, month))
    .reduce((s, l) => s + daysInclusive(l.start, endOf(l)!) - (l.workDays ?? 0), 0);
}

/** その月の月額が免除か（どれか1つの休業で免除、または同じ月の育休の合計が14日以上） */
export function exemptMonth(leaves: LeaveLike[] | undefined, month: YearMonth): boolean {
  return (leaves ?? []).some((l) => leaveExemptsMonth(l, month)) || sameMonthDays(leaves, month) >= 14;
}

/** その賞与が免除か */
export function exemptBonus(leaves: LeaveLike[] | undefined, paidDate: DateStr): boolean {
  const month = toYearMonth(paidDate);
  return (leaves ?? []).some((l) => {
    // 月の末日を含む休業（＝本来の免除の月）。14日ルールだけで免除になる月は賞与には使わない
    if (!leaveExemptsMonth(l, month)) return false;
    const end = endOf(l);
    if (end !== null && toYearMonth(addDays(end, 1)) <= month) return false;
    if (l.kind === 'maternity' || l.start < RULE_2022_FROM) return true;
    return end === null || end > oneMonthEnd(l.start); // 連続して1か月を超える
  });
}

/**
 * 画面に出す「免除される月」（免除がなければ null。to が null なら終了未定）
 * all を渡すと、同じ月のほかの育休と合わせて14日以上かも見る
 */
export function exemptRangeOf(
  l: LeaveLike,
  all?: LeaveLike[],
): { from: YearMonth; to: YearMonth | null } | null {
  if (!isExemptKind(l.kind)) return null;
  const startMonth = toYearMonth(l.start);
  const end = endOf(l);
  if (end === null) return { from: startMonth, to: null };
  if (end < l.start) return null;
  const nextMonth = toYearMonth(addDays(end, 1));
  if (startMonth < nextMonth) return { from: startMonth, to: shiftMonth(nextMonth, -1) };
  const exempt = leaveExemptsMonth(l, startMonth) || (!!all && withinMonth(l, startMonth) && sameMonthDays(all, startMonth) >= 14);
  return exempt ? { from: startMonth, to: startMonth } : null;
}
