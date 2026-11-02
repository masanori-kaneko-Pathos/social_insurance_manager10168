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
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Employee extends EmployeeDoc {
  id: string;
}

export type EmployeeInput = Omit<EmployeeDoc, 'createdAt' | 'updatedAt'>;