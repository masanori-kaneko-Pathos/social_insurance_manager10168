import { Timestamp } from 'firebase/firestore';

/** 標準報酬月額が決まった理由 */
export type RemunerationReason = 'acquisition' | 'regular' | 'irregular' | 'other';

export const REMUNERATION_REASONS: RemunerationReason[] = ['acquisition', 'regular', 'irregular', 'other'];

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