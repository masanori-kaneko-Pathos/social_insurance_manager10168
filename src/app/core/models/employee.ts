import { Timestamp } from 'firebase/firestore';

/** 資格（健康保険・厚生年金それぞれ） */
export interface EnrollmentDoc {
  enrolled: boolean;
  acquiredDate: string | null; // 'YYYY-MM-DD'
  lostDate: string | null;
}

/** Firestore の offices/{officeId}/employees/{employeeId} */
export interface EmployeeDoc {
  employeeNumber: string | null;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: string;
  hireDate: string;
  retireDate: string | null;
  health: EnrollmentDoc;
  pension: EnrollmentDoc;
  leaves?: Leave[]; // 古いデータにはない
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** 産休・育休（終了日 null は「未定」を選んだ） */
export interface Leave {
  kind: 'maternity' | 'childcare';
  start: string; // 'YYYY-MM-DD'
  end: string | null;
}

export interface Employee extends EmployeeDoc {
  id: string;
}

export type EmployeeInput = Omit<EmployeeDoc, 'createdAt' | 'updatedAt'>;
