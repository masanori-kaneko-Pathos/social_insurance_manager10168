import { Timestamp } from 'firebase/firestore';

export type OfficeRole = 'admin' | 'general';
export type HealthInsurerType = 'kyokai' | 'kumiai';

export interface HealthInsurer {
  type: HealthInsurerType;
  kumiaiName: string | null;
}

/** Firestore の offices/{officeId} に保存する中身 */
export interface OfficeDoc {
  name: string;
  corporateName: string | null;
  corporateNumber: string | null;
  ownerName: string;
  postalCode: string | null;
  prefecture: string; // '01'〜'47'（協会けんぽの料率を選ぶ鍵）
  address: string;
  healthInsurer: HealthInsurer;
  officeSymbol: string | null;
  officeNumber: string | null;
  industry: string | null; // 日本標準産業分類の大分類コード 'A'〜'T'
  employeeCount: number | null;
  memberUids: string[];
  memberRoles: Record<string, OfficeRole>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Office extends OfficeDoc {
  id: string;
}

/** 登録・編集の画面から渡す部分（メンバーと日時はサービス側で付ける） */
export type OfficeInput = Omit<OfficeDoc, 'memberUids' | 'memberRoles' | 'createdAt' | 'updatedAt'>;