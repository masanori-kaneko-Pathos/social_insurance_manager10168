/**
 * 全事業所共通のマスタ（アプリからは書かない。投入スクリプトだけが書く）
 * - masterCriteria/{from}：短時間労働者の加入の基準（適用開始の月つき）
 * - masterAgreements/{国}：社会保障協定
 * 料率・等級表は rates.ts
 */

/**
 * 加入の基準（日本年金機構「短時間労働者に対する適用拡大」）
 * 例：2026-10 から賃金要件なし、2027-10 から企業規模 36人以上 …
 */
export interface CriteriaDoc {
  from: string; // 'YYYY-MM'（この月から。＝ ドキュメントID）
  /** 企業規模：法人全体の厚生年金の被保険者がこの人数以上（null ＝ 規模の要件なし） */
  sizeMin: number | null;
  weeklyMinutesMin: number; // 週の所定労働時間の下限（分。20時間 ＝ 1200）
  /** 所定内賃金の下限（null ＝ 賃金要件なし。特定減額特例対象者だけは別） */
  wageMin: number | null;
  /** 特定減額特例対象者の所定内賃金の基準（月8.8万円未満なら原則対象外） */
  reducedWageMin: number | null;
  source: string; // 出典
}

/** 社会保障協定（国ごと） */
export interface AgreementDoc {
  country: string; // 国・地域コード（＝ ドキュメントID）
  name: string; // 国名（日本語）
  from: string; // 発効日
  covers: 'pension' | 'pensionAndHealth';
  /** 一時派遣で日本の保険に残れる期間の上限（年） */
  maxDispatchYears: number | null;
  source: string;
}
