import { Timestamp } from 'firebase/firestore';
import { Sex } from './employee';

/**
 * 扶養家族（offices/{officeId}/employees/{employeeId}/dependents/{自動ID}）
 * 被扶養者（異動）届・国民年金第3号被保険者関係届の材料
 * マイナンバーはここに入れない（別の入れ物で暗号化する）
 */

export type Relationship =
  | 'spouse'
  | 'child'
  | 'parent'
  | 'grandparent'
  | 'sibling'
  | 'grandchild'
  | 'other';
export const RELATIONSHIPS: readonly Relationship[] = [
  'spouse',
  'child',
  'parent',
  'grandparent',
  'sibling',
  'grandchild',
  'other',
];

/** 扶養から外れた理由 */
export type DependentEndReason = 'employment' | 'income' | 'death' | 'separation' | 'other';
export const DEPENDENT_END_REASONS: readonly DependentEndReason[] = [
  'employment',
  'income',
  'death',
  'separation',
  'other',
];

export interface DependentDoc {
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: string;
  sex: Sex | null;
  relationship: Relationship;
  relationshipNote: string | null; // その他のとき
  livingTogether: boolean;
  address: string | null; // 別居のとき
  occupation: string | null;
  annualIncome: number | null; // 年収の見込み（円）
  basicPensionNumber: string | null; // 配偶者（第3号被保険者）のとき
  thirdInsured: boolean; // 国民年金の第3号被保険者
  from: string | null; // 被扶養者になった日
  to: string | null; // 外れた日
  endReason: DependentEndReason | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Dependent extends DependentDoc {
  id: string;
}

export type DependentInput = Omit<DependentDoc, 'createdAt' | 'updatedAt'>;
