import { Timestamp } from 'firebase/firestore';

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
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BonusPayment extends BonusPaymentDoc {
  id: string;
}

/** 画面から保存する形（現物は今の画面にまだないので、なければ係が {} で埋める） */
export type BonusPaymentInput = Pick<BonusPaymentDoc, 'paidDate' | 'title' | 'amounts'> &
  Partial<Pick<BonusPaymentDoc, 'inKindAmounts'>>;
