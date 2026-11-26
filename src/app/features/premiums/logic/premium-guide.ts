// 保険料のページの「毎月の業務の順の案内」の状態（11/26）
// ①本人負担 → ②給与ソフトと照合 → ③納める額 → ④告知額 の段ごとに、済み・要確認・まだ・していない を決める
// Angular・Firebase に依存しない純粋な関数

import type { SoftCheck } from '../../../core/models/month-close';
import type { GuideStep } from '../../../shared/components/step-guide/step-guide';
import type { NoticeStatus } from './notice-check';

/** 告知額のダブルチェック（offices/{o}/reviews/{鍵}）。依頼していなければ null（11/26） */
export interface NoticeReviewState {
  requestedByName: string | null;
  /** 確認した人（まだなら null） */
  checkedByName: string | null;
  /** 確認した日（M/D。まだなら null） */
  checkedOn: string | null;
}

export interface PremiumGuideInput {
  /** この月を確認済みにした記録（なければ null）。誰が・いつ（M/D）は記録にあれば出す（11/26） */
  close: { softCheck?: SoftCheck | null; closedByName?: string | null; closedOn?: string | null } | null;
  /** 先に直す人の数（計算できない人＋定時決定の未反映） */
  fixCount: number;
  /** 今の画面で読んだ控除額のファイルとの照合（この月のもの。読んでいなければ null） */
  softNow: SoftCheck | null;
  /** 告知額を保存したか */
  noticeSaved: boolean;
  /** 告知額とアプリの合計の比べた結果 */
  noticeStatus: NoticeStatus;
  /** 差の理由を1つ以上選んでいるか */
  noticeHasReason: boolean;
  /**
   * 告知額のダブルチェック（11/26）。④は「別の人が確認した」で済みになる
   * 省くと（前の呼び出し）確認を問わない
   */
  noticeReview?: NoticeReviewState | null;
  /** 確認できる別のメンバーがいない（メンバーが1人）。ダブルチェックはできないので、保存で済みにする */
  solo?: boolean;
}

const step = (key: string, state: GuideStep['state'], noteKey?: string, noteParams?: Record<string, unknown>): GuideStep => ({
  key,
  labelKey: `premiumGuide.step.${key}`,
  state,
  noteKey: noteKey ? `premiumGuide.note.${noteKey}` : null,
  noteParams,
});

export function premiumGuideSteps(x: PremiumGuideInput): GuideStep[] {
  const closed = !!x.close;
  // 確認済みの注記：誰が・いつ（記録にあれば。前のデータは「確認済み」だけ）
  const checkedNote = (): [string, Record<string, unknown>?] =>
    x.close?.closedByName && x.close?.closedOn
      ? ['checkedBy', { name: x.close.closedByName, date: x.close.closedOn }]
      : ['checked'];
  const employee = closed ? step('employee', 'done', ...checkedNote()) : x.fixCount > 0 ? step('employee', 'attention', 'fix', { count: x.fixCount }) : step('employee', 'todo');
  // 照合：確認済みなら記録した結果、まだなら今の画面で読んだ結果
  const sc = closed ? (x.close!.softCheck ?? null) : x.softNow;
  const soft = sc
    ? sc.diff > 0
      ? step('soft', 'attention', 'softDiff', { count: sc.diff })
      : step('soft', 'done', 'softMatch', { count: sc.matched })
    : closed
      ? step('soft', 'skipped', 'softNone')
      : step('soft', 'todo');
  const total = closed ? step('total', 'done', ...checkedNote()) : step('total', 'todo');
  return [employee, soft, total, noticeStep(x)];
}

/**
 * 告知額：保存した記録があり、差がないか差の理由を記録していて、さらに別の人が確認したら済み（11/26）
 * - 確認を頼んでいない → まだ（「別の人の確認がまだ」）。頼んだ → まだ（「確認待ち（依頼：○○）」）
 * - 確認できる別のメンバーがいない事業所は、保存で済み（止めると、1人の事業所では終わらないため）
 */
function noticeStep(x: PremiumGuideInput) {
  if (!x.noticeSaved) return step('notice', 'todo', 'noticeWait');
  if (x.noticeStatus === 'diff' && !x.noticeHasReason) return step('notice', 'attention', 'noticeDiff');
  const base = x.noticeStatus === 'diff' ? 'noticeReason' : 'noticeMatch';
  if (x.noticeReview === undefined) return step('notice', 'done', base);
  if (x.solo) return step('notice', 'done', 'noticeSolo');
  const r = x.noticeReview;
  if (r?.checkedByName) return step('notice', 'done', 'noticeChecked', { name: r.checkedByName, date: r.checkedOn ?? '' });
  if (r) return step('notice', 'todo', 'noticeWaiting', { name: r.requestedByName ?? '' });
  return step('notice', 'todo', 'noticeAsk');
}
