import { Timestamp } from 'firebase/firestore';

/**
 * offices/{officeId}/premiumNotices/{YYYY-MM}（納付対象月。＝ ドキュメントID）
 * 年金事務所の「保険料納入告知額」を写し、アプリの合計と突き合わせた結果（差の理由・メモ）を残す
 * アプリの合計は保存しない（開くたびに計算する。届や実績を直したら変わるため）
 */
export interface PremiumNoticeDoc {
  month: string;
  health: number | null; // 健康保険料（介護・子ども・子育て支援金を含む）
  pension: number | null; // 厚生年金保険料
  childContribution: number | null; // 子ども・子育て拠出金
  reasons: string[]; // 確かめた差の理由（notice-check.ts の DIFF_REASONS）
  note: string | null;
  updatedBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type PremiumNotice = Omit<PremiumNoticeDoc, 'createdAt' | 'updatedAt'>;
