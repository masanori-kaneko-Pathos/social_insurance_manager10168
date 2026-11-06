import { Timestamp } from 'firebase/firestore';
import { StandardRemuneration } from './remuneration';

/**
 * 従業員の下の、そのほかの入れ物
 * - 介護保険の適用除外（カタログ【7】）
 * - 海外赴任（カタログ「利用にあたって 5」）
 * - 変更履歴（カタログ【3】）
 * - 遡及計算の結果（カタログ【9】。元のデータは書き換えない）
 */

// ===== 介護保険の適用除外 offices/{o}/employees/{e}/careExemptions/{from} =====

/** 介護施設に入所・海外に居住・在留資格（日本に住所がない など） */
export type CareExemptionReason = 'facility' | 'overseas' | 'residenceStatus';
export const CARE_EXEMPTION_REASONS: readonly CareExemptionReason[] = [
  'facility',
  'overseas',
  'residenceStatus',
];

export interface CareExemptionDoc {
  from: string; // 該当した日（＝ ドキュメントID）
  to: string | null; // 非該当になった日
  reason: CareExemptionReason;
  note: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type CareExemption = Omit<CareExemptionDoc, 'createdAt' | 'updatedAt'>;

// ===== 海外赴任 offices/{o}/employees/{e}/overseas/{from} =====

export interface OverseasDoc {
  from: string; // 赴任した日（＝ ドキュメントID）
  to: string | null;
  country: string; // 国・地域コード
  /** 日本の適用証明書（協定国へ5年以内の一時派遣など。日本の保険に残る） */
  certificateFrom: string | null;
  certificateTo: string | null;
  note: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type Overseas = Omit<OverseasDoc, 'createdAt' | 'updatedAt'>;

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
