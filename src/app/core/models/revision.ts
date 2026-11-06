import { Timestamp } from 'firebase/firestore';
import { StandardRemuneration } from './remuneration';

/**
 * 標準報酬の改定の記録（定時決定・随時改定・休業終了時改定）と、固定的賃金の変動
 * 標準報酬そのものは remunerations/{何月分から} に入れる。ここは「どう決めたか」の記録で、届書の材料にする
 */

// ===== 定時決定 offices/{o}/employees/{e}/regularDecisions/{YYYY} =====

/** 決め方：通常（4〜6月の平均）／年間平均（保険者算定）／従前のまま（3か月とも使えない） */
export type RegularMethod = 'normal' | 'annual' | 'keep';
export const REGULAR_METHODS: readonly RegularMethod[] = ['normal', 'annual', 'keep'];

export interface RegularDecisionDoc {
  officeId: string;
  employeeId: string;
  year: string; // 'YYYY'（＝ ドキュメントID）
  method: RegularMethod;
  usedMonths: string[]; // 平均に使った月（支払った月）
  total: number; // ⑭総計（使った月の通貨＋現物）
  average: number; // ⑮平均額
  corrected: number | null; // ⑯修正平均額（遡及支払があったときだけ）
  annualAverage: number | null; // 年間平均（候補だったときだけ）
  monthlyAmount: number; // 等級を決めた報酬月額
  seasonal: boolean; // 年間平均：業務の性質上、例年発生する
  consent: boolean; // 年間平均：被保険者が同意した
  health: StandardRemuneration;
  pension: StandardRemuneration;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type RegularDecision = Omit<RegularDecisionDoc, 'createdAt' | 'updatedAt'>;

// ===== 固定的賃金の変動 offices/{o}/employees/{e}/wageChanges/{起算月} =====

/** 人が足した（自動で見つからない変動）／外した（固定的賃金の変動ではない） */
export type WageChangeSource = 'manual' | 'dismissed';
export const WAGE_CHANGE_SOURCES: readonly WageChangeSource[] = ['manual', 'dismissed'];

export type WageChangeKind =
  | 'raise' // 昇給
  | 'cut' // 降給
  | 'allowanceNew' // 手当の新設
  | 'allowanceEnd' // 手当の廃止
  | 'unitPrice' // 単価・割合の変更（時給・残業の単価など）
  | 'contractHours' // 契約時間の変更
  | 'inKind' // 現物給与の価額の変更
  | 'other';
export const WAGE_CHANGE_KINDS: readonly WageChangeKind[] = [
  'raise',
  'cut',
  'allowanceNew',
  'allowanceEnd',
  'unitPrice',
  'contractHours',
  'inKind',
  'other',
];

export type ChangeDirection = 'up' | 'down' | 'unclear';
export const CHANGE_DIRECTIONS: readonly ChangeDirection[] = ['up', 'down', 'unclear'];

export interface WageChangeDoc {
  month: string; // 起算月 'YYYY-MM'（変動が1か月分反映された支払月。＝ ドキュメントID）
  source: WageChangeSource;
  kind: WageChangeKind;
  direction: ChangeDirection;
  note: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type WageChange = Omit<WageChangeDoc, 'createdAt' | 'updatedAt'>;

// ===== 随時改定 offices/{o}/employees/{e}/irregularDecisions/{起算月} =====

export interface IrregularDecisionDoc {
  officeId: string;
  employeeId: string;
  startMonth: string; // 起算月（＝ ドキュメントID）
  revisedFrom: string; // 改定月（起算月から4か月目）
  direction: 'up' | 'down'; // ⑦昇給・降給
  usedMonths: string[];
  total: number;
  average: number;
  corrected: number | null;
  retro: number; // ⑧遡及支払額
  monthlyAmount: number;
  special: boolean; // 上限・下限の特例（1等級差）で改定した
  reasonNote: string | null; // 備考「昇給・降給の理由」
  health: StandardRemuneration;
  pension: StandardRemuneration;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type IrregularDecision = Omit<IrregularDecisionDoc, 'createdAt' | 'updatedAt'>;

// ===== 休業終了時改定 offices/{o}/employees/{e}/leaveEndDecisions/{起算月} =====

export interface LeaveEndDecisionDoc {
  officeId: string;
  employeeId: string;
  startMonth: string; // 終了日の翌日が属する月（＝ ドキュメントID）
  leaveKind: 'maternity' | 'childcare'; // 産前産後休業終了時改定／育児休業等終了時改定
  leaveEnd: string; // 休業の終了日
  revisedFrom: string; // 改定月（起算月から4か月目）
  usedMonths: string[];
  total: number;
  average: number;
  monthlyAmount: number;
  health: StandardRemuneration;
  pension: StandardRemuneration;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type LeaveEndDecision = Omit<LeaveEndDecisionDoc, 'createdAt' | 'updatedAt'>;
