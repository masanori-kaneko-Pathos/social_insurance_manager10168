import { Timestamp } from 'firebase/firestore';

/** 標準報酬月額が決まった理由 */
export type RemunerationReason = 'acquisition' | 'regular' | 'irregular' | 'leaveEnd' | 'other';

export const REMUNERATION_REASONS: RemunerationReason[] = [
  'acquisition',
  'regular',
  'irregular',
  'leaveEnd', // 産前産後休業終了時改定・育児休業等終了時改定（どちらかは leaveEndDecisions で分かる）
  'other',
];

/** 決まった等級と標準報酬月額 */
export interface StandardRemuneration {
  grade: number;
  standard: number; // 円
}

/** Firestore の offices/{officeId}/employees/{employeeId}/remunerations/{from} */
export interface RemunerationDoc {
  from: string; // 'YYYY-MM'（この月分から。ドキュメントIDと同じ）
  reason: RemunerationReason;
  monthlyAmount: number; // 報酬月額（円）
  health: StandardRemuneration;
  pension: StandardRemuneration;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type RemunerationInput = Omit<RemunerationDoc, 'createdAt' | 'updatedAt'>;