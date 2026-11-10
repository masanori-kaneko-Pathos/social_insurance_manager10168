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

/** 通常の労働者の所定（4分の3基準・日給月給の所定日数に使う） */
export interface StandardHours {
  weeklyMinutes: number; // 週の所定労働時間（分。40時間 ＝ 2400）
  monthlyDays: number; // 月の所定労働日数
}

/** 特定適用事業所（短時間労働者の加入） */
export interface SpecificApplication {
  since: string | null; // 該当した月 'YYYY-MM'（該当していなければ null）
  voluntary: boolean; // 任意特定適用（労使の合意で申し出た）
  /** 法人全体の厚生年金の被保険者数（アプリに登録していない事業所を含めた手入力。null ＝ アプリの中で数える） */
  insuredCount: number | null;
}

/** 現物の支給があるか（入れ忘れの候補を出すため） */
export interface InKindProvided {
  housing: boolean; // 社宅・寮
  meals: boolean; // 食事
}

/** Firestore の offices/{officeId} に保存する中身 */
export interface OfficeDoc {
  name: string;
  /** 英語の表示に使う名前（任意。英語の画面で、あればこちらを出す。11/10 より前の文書にはない） */
  nameEn?: string | null;
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
  /** 保険者・都道府県の履歴（古い順）。最後の行は prefecture・healthInsurer と同じ */
  insurerHistory: InsurerPeriod[];
  payroll: PayrollSettings;
  premium: PremiumSettings;
  standardHours: StandardHours | null;
  specificApplication: SpecificApplication;
  pensionFund: boolean; // 厚生年金基金に加入（取得届の種別「基金」）
  inKind: InKindProvided;
  bonusMonths: number[]; // 賞与の支払予定月（1〜12）
  memberUids: string[];
  memberRoles: Record<string, OfficeRole>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Office extends OfficeDoc {
  id: string;
}

/** 画面から保存する形（メンバーと日時は係が付ける） */
export type OfficeInput = Omit<OfficeDoc, 'memberUids' | 'memberRoles' | 'createdAt' | 'updatedAt'>;

/** 今の登録・編集画面が扱う項目（それ以外はまとまりごとに保存する） */
export type OfficeBasicInput = Omit<
  OfficeInput,
  'standardHours' | 'specificApplication' | 'pensionFund' | 'inKind' | 'bonusMonths'
>;

/** 登録画面が扱わない項目の初期値（登録のときに係が足す） */
export function officeExtras(): Omit<OfficeInput, keyof OfficeBasicInput> {
  return {
    standardHours: null,
    specificApplication: { since: null, voluntary: false, insuredCount: null },
    pensionFund: false,
    inKind: { housing: false, meals: false },
    bonusMonths: [],
  };
}

/**
 * 従業員に見せてよい事業所の設定（offices/{o}/shared/forEmployees）
 * 事業所の文書そのもの（住所・番号・メンバーなど）は従業員に見せない。
 * マイページの保険料の計算に要るものだけを、管理者が保存するたびに写す（掲示板に貼り出すイメージ）
 */
export interface OfficeForEmployeesDoc {
  name: string;
  prefecture: string;
  healthInsurer: HealthInsurer;
  insurerHistory: InsurerPeriod[];
  premium: PremiumSettings;
  updatedAt: Timestamp;
}

export const FOR_EMPLOYEES_KEYS = ['name', 'prefecture', 'healthInsurer', 'insurerHistory', 'premium'] as const;
