import { Timestamp } from 'firebase/firestore';
import { Lang } from '../i18n/language.service';

export type UserRole = 'admin' | 'general';

/** Firestore の users/{uid} に保存する中身 */
export interface AppUserDoc {
  email: string;
  displayName: string;
  role: UserRole;
  currentOfficeId: string | null; // 最後に開いた事業所
  lang: Lang;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** アプリ内で使う形（uid を足したもの） */
export interface AppUser extends AppUserDoc {
  uid: string;
}