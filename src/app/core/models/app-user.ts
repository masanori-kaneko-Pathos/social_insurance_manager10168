import { Timestamp } from 'firebase/firestore';
import { Lang } from '../i18n/language.service';

/** admin ＝ 事業所を作れるアカウント／general ＝ 招待された一般ユーザー／employee ＝ 従業員（マイページだけ） */
export type UserRole = 'admin' | 'general' | 'employee';

export interface EmployeeRef {
  officeId: string;
  employeeId: string;
  inviteCode: string;
}

/** Firestore の users/{uid} に保存する中身 */
export interface AppUserDoc {
  email: string;
  displayName: string;
  role: UserRole;
  currentOfficeId: string | null; // 最後に開いた事業所
  lang: Lang;
  /** 従業員のアカウントのとき、どの従業員か。使った招待のコードも持つ（ルールが招待と照らし合わせる）。それ以外は null */
  employeeRef: EmployeeRef | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** アプリ内で使う形（uid を足したもの） */
export interface AppUser extends AppUserDoc {
  uid: string;
}