import { Timestamp } from 'firebase/firestore';

/**
 * 料率の単位：0.0001% を 1 とする整数（10.06% → 100600、4.2371% → 42371）
 * 小数のずれで端数処理が狂わないよう、料率は必ずこの整数で持つ。
 */
export type RateMicro = number;

/** 割合 × RATE_SCALE ＝ RateMicro（0.1006 × 1,000,000 ＝ 100600） */
export const RATE_SCALE = 1_000_000;

/** 料率マスタの種類 */
export type NationalRateKind = 'care' | 'childSupport' | 'pension' | 'childContribution';
export type MasterRateKind = 'kyokaiHealth' | NationalRateKind;

/**
 * Firestore の masterRates/{kind}_{from}（全事業所共通。アプリからは書かない）
 * - kyokaiHealth：協会けんぽの健康保険料率（都道府県コード → 合計の率）
 * - それ以外：全国一律の合計の率
 * from は 'YYYY-MM'（この月分の保険料から使う）
 */
export type MasterRateDoc =
  | {
      kind: 'kyokaiHealth';
      from: string;
      byPrefecture: Record<string, RateMicro>;
      source: string;
    }
  | {
      kind: NationalRateKind;
      from: string;
      rate: RateMicro;
      source: string;
    };

/** 本人分と会社分 */
export interface RateSplit {
  employee: RateMicro;
  employer: RateMicro;
}

/** Firestore の offices/{officeId}/kumiaiRates/{from}（組合健保の料率） */
export interface KumiaiRateDoc {
  from: string; // 'YYYY-MM'（ドキュメントIDと同じ）
  health: RateSplit;
  care: RateSplit;
  childSupport: RateSplit;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type KumiaiRateInput = Omit<KumiaiRateDoc, 'createdAt' | 'updatedAt'>;

/** 選ばれた1つの料率（計算の根拠として画面にも出す） */
export interface PickedRate extends RateSplit {
  from: string; // いつからの率か
  source: 'kyokai' | 'kumiai' | 'national';
}

/** ある月に使う料率一式。null は「料率未登録」（計算しない） */
export interface RatesForMonth {
  month: string;
  health: PickedRate | null;
  care: PickedRate | null;
  childSupport: PickedRate | null;
  pension: PickedRate | null;
  childContribution: PickedRate | null; // 子ども・子育て拠出金（会社だけが負担）
}

/** 月の範囲（to の月は含まない。null は今も続いている） */
export interface MonthRange {
  from: string; // 'YYYY-MM'
  to: string | null;
}

// ===== 標準報酬月額の等級表 =====

/** 等級表の1行（報酬月額が min 以上、次の行の min 未満ならこの等級） */
export interface GradeRow {
  grade: number;
  standard: number; // 標準報酬月額（円）
  min: number; // 報酬月額の下限（円・以上）
}

/** Firestore の masterGrades/{kind}_{from}（全事業所共通。アプリからは書かない） */
export interface GradeTableDoc {
  kind: 'health' | 'pension';
  from: string; // 'YYYY-MM'
  grades: GradeRow[];
  source: string;
}
