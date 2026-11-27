import { Timestamp } from 'firebase/firestore';

/** 標準報酬月額が決まった理由 */
export type RemunerationReason = 'acquisition' | 'regular' | 'irregular' | 'leaveEnd' | 'special' | 'other';

export const REMUNERATION_REASONS: RemunerationReason[] = [
  'acquisition',
  'regular',
  'irregular',
  'leaveEnd', // 産前産後休業終了時改定・育児休業等終了時改定（どちらかは leaveEndDecisions で分かる）
  'special', // 特例改定（令和9年1月から。療養・育児・介護で報酬が急に下がった・戻った。specialRevisions で分かる）
  'other',
];

/** 決まった等級と標準報酬月額 */
export interface StandardRemuneration {
  grade: number;
  standard: number; // 円
}

/**
 * 二以上事業所勤務の人の按分（11/28。決定通知書の額を入れる）
 * - own：この事業所の報酬月額／total：全部の事業所の報酬月額の合計（保険料 ＝ 全額 × own ÷ total）
 * - insurer：本人が選んだ事業所の健康保険
 *   office ＝ この事業所と同じ／kyokai ＝ 協会けんぽ（prefecture の都道府県の料率）／other ＝ ほかの健康保険組合（料率が分からないので健保は計算しない）
 */
export type MultiOfficeInsurer = 'office' | 'kyokai' | 'other';
export const MULTI_OFFICE_INSURERS: readonly MultiOfficeInsurer[] = ['office', 'kyokai', 'other'];
export interface MultiOffice {
  own: number;
  total: number;
  insurer: MultiOfficeInsurer;
  /** insurer が kyokai のときの都道府県（'01'〜'47'）。ほかは null */
  prefecture: string | null;
}

/** Firestore の offices/{officeId}/employees/{employeeId}/remunerations/{from} */
export interface RemunerationDoc {
  from: string; // 'YYYY-MM'（この月分から。ドキュメントIDと同じ）
  reason: RemunerationReason;
  monthlyAmount: number; // 報酬月額（円）
  health: StandardRemuneration;
  pension: StandardRemuneration;
  /** 二以上事業所勤務の按分（その人だけ。ない・null ＝ 按分しない。11/28） */
  multi?: MultiOffice | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type RemunerationInput = Omit<RemunerationDoc, 'createdAt' | 'updatedAt'>;