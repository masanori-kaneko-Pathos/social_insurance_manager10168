import { Timestamp } from 'firebase/firestore';
import type { ClosePeople, Settlement } from '../../features/premiums/logic/month-close';

/**
 * offices/{officeId}/monthCloses/{YYYY-MM}（保険料の月。＝ ドキュメントID。11/24）
 * 「この月はこの額で控除した」記録。作成と取り消し（削除）だけで、書き換えない
 * 毎月の保険料だけ（賞与は支給ごとの文書があるので含めない）
 */
export interface MonthCloseDoc {
  month: string;
  /** 従業員ID → 本人負担（円）・保険料の全額（1/1000円）・拠出金（1/1000円） */
  people: ClosePeople;
  /** 確定したときの合計（告知額と見比べる材料） */
  count: number;
  employeeYen: number;
  premiumTotalMilli: number;
  contributionMilli: number;
  closedBy: string;
  /** 確定した人の表示名（一覧で「○○さんが確定」と出すため。メンバーが外れても残る） */
  closedByName: string | null;
  closedAt: Timestamp;
  /**
   * 給与ソフトとの照合の結果（11/26）。確認済みにしたとき、同じ月の控除額のファイルと比べていれば人数を残す
   * null ＝ 照合しないで確認済みにした。前のデータにはない（照合なしと同じ）
   */
  softCheck?: SoftCheck | null;
}

/** 給与ソフトとの照合の結果（一致した人数・差などで確かめが要る人数） */
export interface SoftCheck {
  matched: number;
  diff: number;
}

export type MonthClose = MonthCloseDoc;

/** offices/{officeId}/monthCloses/{YYYY-MM}/settlements/{employeeId}：精算した給与の月と、そのときの差額 */
export interface SettlementDoc extends Settlement {
  recordedBy: string;
  recordedAt: Timestamp;
}
