import { Timestamp } from 'firebase/firestore';
import { StandardRemuneration } from './remuneration';

/**
 * 従業員の下の、そのほかの入れ物
 * - 介護保険の適用除外（カタログ【7】）
 * （海外勤務は従業員の文書の overseas に移した。To-do で全員分を読むため。11/12）
 * - 変更履歴（カタログ【3】）
 * - 遡及計算の結果（カタログ【9】。元のデータは書き換えない）
 */

// ===== 変更履歴 offices/{o}/employees/{e}/history/{自動ID} =====

export interface HistoryDoc {
  /** 何を変えたか（'employee' ＝ 従業員の文書、'contracts/2026-04-01' など） */
  target: string;
  field: string; // 'contact.address' など
  before: string | null; // 変更前（JSON の文字）
  after: string | null; // 変更後（JSON の文字）
  changedBy: string; // uid
  changedAt: Timestamp;
}

export interface ChangeHistory extends HistoryDoc {
  id: string;
}

// ===== 遡及計算の結果 offices/{o}/employees/{e}/recalcs/{自動ID} =====

/** 訂正した期間ごとの標準報酬 */
export interface RecalcPeriod {
  from: string; // 'YYYY-MM'
  to: string | null;
  health: StandardRemuneration | null; // null ＝ その期間は加入していない
  pension: StandardRemuneration | null;
}

/** 1か月分の差額 */
export interface RecalcMonth {
  month: string;
  beforeEmployeeYen: number;
  afterEmployeeYen: number;
  beforeTotalMilli: number;
  afterTotalMilli: number;
  /** 時効（2年）を過ぎた月 */
  expired: boolean;
}

export interface RecalcDoc {
  reason: string; // 何の訂正か（「資格取得日の訂正」など）
  periods: RecalcPeriod[];
  months: RecalcMonth[];
  diffEmployeeYen: number; // 本人の追加徴収（マイナスなら返金）
  diffEmployerMilli: number; // 会社の追加分
  createdBy: string;
  createdAt: Timestamp;
}

export interface Recalc extends RecalcDoc {
  id: string;
}
