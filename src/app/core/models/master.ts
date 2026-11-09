/**
 * 全事業所共通のマスタ（アプリからは書かない。投入スクリプトだけが書く）
 * - masterCriteria/{from}：短時間労働者の加入の基準（適用開始の月つき）
 * - masterAgreements/{国}：社会保障協定
 * - masterInKind/{from}：現物給与の価額（都道府県ごと。適用開始の月つき）
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

/**
 * 社会保障協定（国ごと。日本年金機構「協定を結んでいる国との協定発効時期および対象となる社会保障制度」）
 * 相手国から日本へ一時派遣され、相手国の適用証明書がある人は、ここで日本側が免除される制度に入らない
 */
export interface AgreementDoc {
  country: string; // 国・地域コード ISO 3166-1 alpha-2（＝ ドキュメントID）
  name: string; // 国名（日本語）
  from: string; // 発効した月 'YYYY-MM'（機構の表は年月まで）
  /** 日本側で免除される制度：年金だけ／年金と医療（医療が免除なら介護も） */
  covers: 'pension' | 'pensionAndHealth';
  /** 年金加入期間の通算ができるか */
  totalization: boolean;
  /** 注意書き（オーストリアの医療保険など） */
  note: string | null;
  source: string;
}

/** 食事の価額（1人あたり。円） */
export interface InKindMeal {
  month: number; // 1か月（3食とも毎日）
  day: number; // 1日（朝・昼・夕の合計）
  breakfast: number;
  lunch: number;
  dinner: number;
}

/** 1つの都道府県の価額 */
export interface InKindPrefecture {
  name: string;
  meal: InKindMeal;
  /** 住宅の利益の額（1か月・1人あたり）：housingUnit が tatami なら1畳、sqm なら総面積1平方メートルにつき */
  housing: number;
}

/**
 * 現物給与の価額（厚生労働大臣が定める価額。日本年金機構「全国現物給与価額一覧表」）
 * 2026-10 から住宅は「1畳につき」→「総面積1平方メートルにつき」に変わった
 */
export interface InKindDoc {
  from: string; // 'YYYY-MM'（この月から。＝ ドキュメントID）
  housingUnit: 'tatami' | 'sqm';
  /** '01'〜'47' → 価額 */
  prefectures: Record<string, InKindPrefecture>;
  source: string;
}
