// 担当者のダブルチェック：作った人が「確認を頼む」→ 別の人が「確認した」
// Angular・Firebase に依存しない純粋な関数（画面のボタンの出し分け。同じ決まりをルールでも確かめる）
//
// 実務：届を出す前・保険料を納める前に、作った人とは別の人が確かめる（作った人が自分で確認済みにはできない）

export type ReviewState = 'none' | 'requested' | 'checked';

export interface ReviewLike {
  requestedBy: string;
  checkedBy: string | null;
}

export function reviewState(r: ReviewLike | null): ReviewState {
  if (!r) return 'none';
  return r.checkedBy ? 'checked' : 'requested';
}

/** 「確認した」を押せるか：頼まれていて、まだ確認されておらず、頼んだ本人ではない（メンバーなら一般でもよい） */
export function canCheck(r: ReviewLike | null, uid: string | null): boolean {
  return !!uid && reviewState(r) === 'requested' && r!.requestedBy !== uid;
}

/** 「確認を頼む」を押せるか：管理者で、まだ頼んでいない */
export function canRequest(r: ReviewLike | null, isAdmin: boolean): boolean {
  return isAdmin && reviewState(r) === 'none';
}

/** 確認の対象の鍵（ドキュメントID）：届書の一覧は様式と期間、納付の突き合わせは月 */
export function filingReviewId(kind: string, period: string): string {
  return `filing_${kind}_${period}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

export function noticeReviewId(month: string): string {
  return `notice_${month}`;
}
