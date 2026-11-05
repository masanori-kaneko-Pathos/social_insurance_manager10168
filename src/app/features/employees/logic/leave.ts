/**
 * 産休・育休による保険料の免除（月額・賞与）
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 *
 * 月額（日本年金機構）
 * - 休業を始めた日の月 〜 終了日の翌日の月の前月 が免除
 * - 育休で、開始月と「終了日の翌日の月」が同じ（月の中で終わる）なら、
 *   その月に14日以上（休日を含む）休んでいれば免除（2022年10月1日以降に始まった育休だけ）
 *   ※ 休業中の就業日は除く決まりだが、就業日のデータがないので「就業なし」として数える
 * 賞与
 * - 産休：支払月が免除の月なら免除
 * - 育休：支払月が免除の月（＝月の末日を含む）で、かつ休業が連続して1か月を超えるときだけ免除
 *   （2022年10月1日以降に始まった育休。終了日が未定のときは「超える」とみなす）
 * 免除でも標準賞与額は決まり、健保の年度累計には入る（日本年金機構）
 */
import { addDays, DateStr, shiftMonth, toYearMonth, YearMonth } from './coverage';

export type LeaveKind = 'maternity' | 'childcare'; // 産休 ／ 育休

export interface LeaveLike {
  kind: LeaveKind;
  start: DateStr;
  end: DateStr | null; // null ＝「未定」を選んだ
}

/** 休業の記録を持つもの（Employee をそのまま渡せる。古いデータには leaves がない） */
export interface LeaveHolder {
  leaves?: LeaveLike[];
}

/** 同月14日のルール・賞与の1か月超のルールが始まった日 */
export const RULE_2022_FROM = '2022-10-01';

function utc(date: DateStr): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** a〜b の日数（両端を含む） */
export function daysInclusive(a: DateStr, b: DateStr): number {
  return Math.round((utc(b) - utc(a)) / 86_400_000) + 1;
}

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
  const startMonth = toYearMonth(l.start);
  if (month < startMonth) return false;
  if (l.end === null) return true; // 未定：開始月から先はずっと
  if (l.end < l.start) return false;
  const nextMonth = toYearMonth(addDays(l.end, 1));
  if (month < nextMonth) return true;
  // 月の中で終わる育休：14日以上なら開始月を免除
  return (
    l.kind === 'childcare' &&
    month === startMonth &&
    startMonth === nextMonth &&
    l.start >= RULE_2022_FROM &&
    daysInclusive(l.start, l.end) >= 14
  );
}

/** その月の月額が免除か（どれか1つの休業で免除なら免除） */
export function exemptMonth(leaves: LeaveLike[] | undefined, month: YearMonth): boolean {
  return (leaves ?? []).some((l) => leaveExemptsMonth(l, month));
}

/** その賞与が免除か */
export function exemptBonus(leaves: LeaveLike[] | undefined, paidDate: DateStr): boolean {
  const month = toYearMonth(paidDate);
  return (leaves ?? []).some((l) => {
    // 月の末日を含む休業（＝本来の免除の月）。14日ルールだけで免除になる月は賞与には使わない
    if (!leaveExemptsMonth(l, month)) return false;
    if (l.end !== null && toYearMonth(addDays(l.end, 1)) <= month) return false;
    if (l.kind === 'maternity' || l.start < RULE_2022_FROM) return true;
    return l.end === null || l.end > oneMonthEnd(l.start); // 連続して1か月を超える
  });
}

/** 画面に出す「免除される月」（免除がなければ null。to が null なら終了未定） */
export function exemptRangeOf(l: LeaveLike): { from: YearMonth; to: YearMonth | null } | null {
  const startMonth = toYearMonth(l.start);
  if (l.end === null) return { from: startMonth, to: null };
  if (l.end < l.start) return null;
  const nextMonth = toYearMonth(addDays(l.end, 1));
  if (startMonth < nextMonth) return { from: startMonth, to: shiftMonth(nextMonth, -1) };
  return leaveExemptsMonth(l, startMonth) ? { from: startMonth, to: startMonth } : null;
}
