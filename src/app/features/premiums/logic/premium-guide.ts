// 保険料のページの「毎月の業務の順の案内」の状態（11/26）
// ①本人負担 → ②給与ソフトと照合 → ③納める額 → ④告知額 の段ごとに、済み・要確認・まだ・していない を決める
// Angular・Firebase に依存しない純粋な関数

import type { SoftCheck } from '../../../core/models/month-close';
import type { GuideStep } from '../../../shared/components/step-guide/step-guide';
import type { NoticeStatus } from './notice-check';

export interface PremiumGuideInput {
  /** この月を確認済みにした記録（なければ null） */
  close: { softCheck?: SoftCheck | null } | null;
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
  const employee = closed ? step('employee', 'done', 'checked') : x.fixCount > 0 ? step('employee', 'attention', 'fix', { count: x.fixCount }) : step('employee', 'todo');
  // 照合：確認済みなら記録した結果、まだなら今の画面で読んだ結果
  const sc = closed ? (x.close!.softCheck ?? null) : x.softNow;
  const soft = sc
    ? sc.diff > 0
      ? step('soft', 'attention', 'softDiff', { count: sc.diff })
      : step('soft', 'done', 'softMatch', { count: sc.matched })
    : closed
      ? step('soft', 'skipped', 'softNone')
      : step('soft', 'todo');
  const total = closed ? step('total', 'done', 'checked') : step('total', 'todo');
  // 告知額：保存した記録があるときだけ済み。差があっても理由を記録していれば済み
  const notice = !x.noticeSaved
    ? step('notice', 'todo', 'noticeWait')
    : x.noticeStatus === 'diff'
      ? x.noticeHasReason
        ? step('notice', 'done', 'noticeReason')
        : step('notice', 'attention', 'noticeDiff')
      : step('notice', 'done', 'noticeMatch');
  return [employee, soft, total, notice];
}
