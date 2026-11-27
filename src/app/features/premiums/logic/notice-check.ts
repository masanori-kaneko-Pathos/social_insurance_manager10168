// 毎月の納付額の突き合わせ：年金事務所の「保険料納入告知額」と、アプリの事業所の合計を比べる
// Angular・Firebase に依存しない純粋な関数
//
// 根拠：日本年金機構「厚生年金保険料等の納付」
// - 納付期限は、納付対象月の翌月末日（末日が休日なら、翌日以降の最初の営業日）。告知書は毎月20日ごろ届く
// - 事業所の保険料（納付額）は、全員の全額を足してから1円未満を切り捨てる。会社負担 ＝ 納付額 − 本人負担の合計
// アプリの事業所の合計も同じ計算（賞与のある月は月額と賞与を足してから切り捨て。11/24）なので、
// 告知額と1円もずれない。ずれたら本当の理由がある

import type { OfficeTotal } from '../../../core/models/premium';
import { addDays, DateStr, daysInMonth, shiftMonth, YearMonth } from '../../../shared/utils/date';

export type NoticeCategory = 'health' | 'pension' | 'childContribution';
export const NOTICE_CATEGORIES: readonly NoticeCategory[] = ['health', 'pension', 'childContribution'];

/**
 * 突き合わせの行の名前（翻訳のキー）
 * 組合健保の月は、健康保険（介護・支援金を含む）を健康保険組合が集める。年金事務所の告知書に健保の行はないので、
 * 健保の行は「健康保険組合からの請求額」と比べる（厚年・拠出金は年金事務所の告知額のまま。11/24）
 */
export function noticeLabelKey(category: NoticeCategory, kumiai: boolean): string {
  return kumiai && category === 'health' ? 'premiumNotice.kumiaiHealth' : `premiumList.category.${category}`;
}

/** 告知額（円）。入れていなければ null */
export type NoticeAmounts = Record<NoticeCategory, number | null>;

/** 差の理由（よくあるもの。確かめた理由に印を付ける） */
export const DIFF_REASONS = [
  'acquireLoss', // 月の途中の取得・喪失（アプリの登録と届の内容が違う）
  'pendingFiling', // 届が年金事務所でまだ処理されていない（反映待ち）
  'bonusFiling', // 賞与支払届の出し忘れ・反映待ち
  'retroAdjust', // 前の月までのさかのぼりの訂正（告知額に調整が入っている）
  'gradeChange', // 標準報酬（定時決定・随時改定）の反映の時期の違い
  'rateMonth', // 料率の登録や適用月の違い（組合の料率の入れ違い・料率が変わる月。11/27）
  'registeredFiled', // 登録した標準報酬と、届出・決定通知書の値の違い（11/27）
  'excluded', // アプリで計算できない人がいる（合計から抜けている）
  'other',
] as const;
export type DiffReason = (typeof DIFF_REASONS)[number];

export interface NoticeLine {
  category: NoticeCategory;
  app: number;
  notice: number | null;
  /** 告知額 − アプリ（入れていなければ null） */
  diff: number | null;
}

export type NoticeStatus = 'notEntered' | 'match' | 'diff';

export interface NoticeCheck {
  lines: NoticeLine[];
  appTotal: number;
  noticeTotal: number | null;
  diffTotal: number | null;
  status: NoticeStatus;
}

/** 平日か（土日だけを休みとして見る） */
function isWeekend(d: DateStr): boolean {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** 金融機関の年末年始の休み（12/31〜1/3） */
function isYearEnd(d: DateStr): boolean {
  const md = d.slice(5);
  return md === '12-31' || md === '01-01' || md === '01-02' || md === '01-03';
}

/**
 * 納付期限：納付対象月の翌月末日。土日・年末年始（12/31〜1/3）なら、次の営業日
 * ※ 国民の祝日は見ていない（月末が祝日になるのはまれ。告知書の期限が正）
 */
export function dueDateOf(month: YearMonth): DateStr {
  const next = shiftMonth(month, 1);
  let d = `${next}-${String(daysInMonth(next)).padStart(2, '0')}`;
  while (isWeekend(d) || isYearEnd(d)) d = addDays(d, 1);
  return d;
}

/** 告知書が届くころ（毎月20日ごろ。納付対象月の翌月） */
export function noticeArrivalOf(month: YearMonth): DateStr {
  return `${shiftMonth(month, 1)}-20`;
}

/**
 * アプリの合計（月額＋その月の賞与）と告知額を比べる。1円でも違えば diff
 */
export function checkNotice(appTotals: readonly OfficeTotal[], notice: NoticeAmounts): NoticeCheck {
  const appOf = (c: NoticeCategory) => appTotals.find((t) => t.category === c)?.totalYen ?? 0;
  const lines = NOTICE_CATEGORIES.map((category) => {
    const app = appOf(category);
    const n = notice[category];
    return { category, app, notice: n, diff: n == null ? null : n - app };
  });
  const appTotal = lines.reduce((s, l) => s + l.app, 0);
  const entered = lines.every((l) => l.notice != null);
  const noticeTotal = entered ? lines.reduce((s, l) => s + l.notice!, 0) : null;
  const diffTotal = noticeTotal == null ? null : noticeTotal - appTotal;
  let status: NoticeStatus = 'notEntered';
  if (entered) {
    status = lines.every((l) => l.diff === 0) ? 'match' : 'diff';
  }
  return { lines, appTotal, noticeTotal, diffTotal, status };
}
