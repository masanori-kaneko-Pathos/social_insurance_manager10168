import { Timestamp } from 'firebase/firestore';
import type { BonusCountAs } from '../../features/premiums/logic/bonus-nature';

/**
 * Firestore の offices/{officeId}/bonusPayments/{自動ID}（賞与の支給1回分）
 * 賞与支払届と同じく「1回の支給 ＝ 1件」。払っていない人は amounts に入れない。
 * 標準賞与額・上限を当てた額は保存しない（賞与額から毎回計算する）。
 */
export interface BonusPaymentDoc {
  paidDate: string; // 'YYYY-MM-DD'（同じ事業所で同じ支払日の支給は1つだけ。アプリで確かめる）
  title: string | null; // 「夏季賞与」など
  amounts: Record<string, number>; // 従業員ID → 賞与額（通貨。円・整数）
  inKindAmounts: Record<string, number>; // 従業員ID → 現物の額（円・整数。賞与支払届の「現物」）
  /**
   * 性質（年4回以上かを数えるまとまり。空・なしは「賞与」。11/19）
   * 名称にかかわらず同じ性質の支給ごとに数える（局部長通知 1(2)ア・令和5年 Q&A Q3）。bonus-nature.ts
   */
  nature?: string | null;
  /** 回数の数え方（なしは normal）：split＝例外的な分割の続き／oneOff＝その年に限りの支給（11/19） */
  countAs?: BonusCountAs | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BonusPayment extends BonusPaymentDoc {
  id: string;
}

/** 画面から保存する形（現物は今の画面にまだないので、なければ係が {} で埋める） */
export type BonusPaymentInput = Pick<BonusPaymentDoc, 'paidDate' | 'title' | 'amounts'> &
  Partial<Pick<BonusPaymentDoc, 'inKindAmounts' | 'nature' | 'countAs'>>;
