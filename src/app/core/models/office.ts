import { Timestamp } from 'firebase/firestore';
import { PremiumOptions } from './premium';

export type OfficeRole = 'admin' | 'general';
export type HealthInsurerType = 'kyokai' | 'kumiai';

export interface HealthInsurer {
  type: HealthInsurerType;
  kumiaiName: string | null;
}

/**
 * 保険者・都道府県の履歴の1行（from の月分から、この保険者・都道府県）
 * from が '0000-01' の行は「最初から」を表す
 */
export interface InsurerPeriod {
  from: string; // 'YYYY-MM'
  prefecture: string;
  healthInsurer: HealthInsurer;
}

/** 給与の設定（日は 1〜31。31 は月末） */
export interface PayrollSettings {
  closingDay: number; // 締日
  payDay: number; // 支払日
  payMonth: 'current' | 'next'; // 支払日は締めた月の当月か翌月か
  deduction: 'current' | 'next'; // 保険料の控除：当月分を当月の給与から／前月分を当月の給与から
}

/** 保険料の計算方法（method：本人負担の集め方、healthRounding：健保・介護・支援金の端数処理） */
export type PremiumSettings = PremiumOptions;

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
  /** 保険者・都道府県の履歴（古い順）。最後の行は prefecture・healthInsurer と同じ。古いデータにはない */
  insurerHistory?: InsurerPeriod[];
  /** 古いデータにはない（読むときに初期値で埋める） */
  payroll?: PayrollSettings;
  premium?: PremiumSettings;
  memberUids: string[];
  memberRoles: Record<string, OfficeRole>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Office extends OfficeDoc {
  id: string;
}

/** 登録・編集の画面から渡す部分（メンバーと日時はサービス側で付ける。新しい項目は必ず入れる） */
export type OfficeInput = Omit<
  OfficeDoc,
  | 'memberUids'
  | 'memberRoles'
  | 'createdAt'
  | 'updatedAt'
  | 'insurerHistory'
  | 'payroll'
  | 'premium'
> &
  Required<Pick<OfficeDoc, 'insurerHistory' | 'payroll' | 'premium'>>;
