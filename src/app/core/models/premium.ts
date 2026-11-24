import { PickedRate } from './rates';

/**
 * 金額の単位：1/1000円 を 1 とする整数（29,550.4円 → 29550400）
 * 標準報酬月額・標準賞与額は必ず1,000円単位なので、
 * 「金額 ÷ 1,000 × 料率（RateMicro）」が割り算なしでぴったり整数になる。
 */
export type Milli = number;

/** 本人負担の集め方：給与（賞与）から控除する／本人が現金で払う */
export type CollectionMethod = 'payroll' | 'cash';

/** 健保・介護・支援金の端数処理：合算してから1回／それぞれ別々に */
export type HealthRounding = 'combined' | 'separate';

/**
 * 労使協定（特約）による本人負担の端数処理（11/16）
 * 協会けんぽ・年金機構の保険料額表の注「事業主と被保険者間で特約がある場合には、特約に基づき端数処理をすることができます」
 * half：四捨五入（50銭以上切り上げ）／floor：切り捨て／ceil：切り上げ。null・省略 ＝ 法律どおり（集め方で決まる）
 */
export type AgreementRounding = 'half' | 'floor' | 'ceil';
export const AGREEMENT_ROUNDINGS: readonly AgreementRounding[] = ['half', 'floor', 'ceil'];

export interface PremiumOptions {
  method: CollectionMethod;
  healthRounding: HealthRounding;
  agreementRounding?: AgreementRounding | null;
}

export const DEFAULT_PREMIUM_OPTIONS: PremiumOptions = {
  method: 'payroll',
  healthRounding: 'combined',
};

/** 保険料の種類 */
export type PremiumPart = 'health' | 'care' | 'childSupport' | 'pension' | 'childContribution';

/** 1つの保険料の計算過程（画面に根拠として出す） */
export interface PremiumLine {
  part: PremiumPart;
  base: number; // 標準報酬月額 または 標準賞与額（円）
  grade: number | null; // 等級（賞与は null）
  rate: PickedRate; // 使った料率（本人分・会社分・いつからの率か）
  totalMilli: Milli; // 全額（本人分＋会社分）
  employeeMilli: Milli; // 本人分（端数処理の前。保険料調整制度で軽減したあとの額）
  /** 保険料調整制度で本人分から引いた額（0.001円単位。会社が一時的に多く払う。なければ省く。11/16） */
  reductionMilli?: Milli;
}

/** 端数処理をまとめて行う単位（合算なら 健保＋介護＋支援金 で1つ） */
export interface PremiumGroup {
  parts: PremiumPart[];
  lines: PremiumLine[];
  totalMilli: Milli;
  employeeYen: number; // 本人負担（端数処理の後）
  employerMilli: Milli; // 会社負担の目安 ＝ 全額 − 本人負担（小数が出ることがある）
}

/** 保険料がかかるはずなのに計算できなかった理由 */
export type MissingReason = 'noRemuneration' | 'noRate';

export interface PremiumResult {
  kind: 'monthly' | 'bonus';
  month: string; // 何月分の保険料か（賞与は支払った月）
  groups: PremiumGroup[];
  /** 加入しているのに計算できなかった保険料（空なら全部計算できた） */
  missing: { part: PremiumPart; reason: MissingReason }[];
  totalMilli: Milli;
  employeeYen: number;
  employerMilli: Milli;
  /** 産休・育休で免除（保険料は0円。標準報酬月額・標準賞与額は決まっている） */
  exempt?: boolean;
  /** 免除の条件に当たるが、申出書がまだなので保険料をかけている（申出すれば免除。11/19） */
  exemptPending?: boolean;
}

/** 賞与1回分の結果（月額の結果に、標準賞与額と上限の情報を足したもの） */
export interface BonusPremiumResult extends PremiumResult {
  paidDate: string;
  amount: number; // 賞与額（円）
  standardBonus: number; // 標準賞与額（1,000円未満切り捨て）
  healthBase: number; // 健保・介護・支援金に使った額（年度累計573万円の上限を当てた後）
  pensionBase: number; // 厚年・拠出金に使った額（月150万円の上限を当てた後）
  /** 健保：charged＝保険料がかかる／counted＝かからないが累計には入る（喪失月）／none */
  healthStatus: 'charged' | 'counted' | 'none';
  pensionStatus: 'charged' | 'none';
  /** その年度の、前の事業所の健保の標準賞与額（累計に足した額。なければ 0。11/16） */
  priorHealth?: number;
}

/** 事業所の合計（納付額・本人負担の合計・会社負担） */
export interface OfficeTotal {
  category: 'health' | 'pension' | 'childContribution';
  totalYen: number; // 納付額 ＝ 全員の全額の合計（1円未満切り捨て）
  totalMilli?: Milli; // 切り捨てる前の全額の合計（月額と賞与を足してから切り捨てるため。11/24）
  employeeYen: number; // 本人負担の合計
  employerYen: number; // 会社負担 ＝ 納付額 − 本人負担の合計
}
