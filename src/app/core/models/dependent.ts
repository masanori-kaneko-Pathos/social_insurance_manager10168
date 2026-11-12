import { Timestamp } from 'firebase/firestore';
import { Sex } from './employee';

/**
 * 扶養家族（offices/{officeId}/employees/{employeeId}/dependents/{自動ID}）
 * 被扶養者（異動）届・国民年金第3号被保険者関係届（様式コード 2202）の欄に合わせる
 * - 第3号被保険者か・扶養の基準を満たすかは保存しない（毎回計算する）
 * - マイナンバーはここに入れない（別の入れ物で暗号化する）
 */

/** 続柄（届書 B③・C④）。配偶者は「未届」を commonLaw で持つ */
export const RELATIONSHIPS = [
  'spouse', // 夫・妻
  'child', // 実子・養子
  'otherChild', // 1以外の子（配偶者の連れ子など）
  'parent', // 父母・養父母
  'parentInLaw', // 義父母
  'youngerSibling', // 弟妹
  'olderSibling', // 兄姉
  'grandparent', // 祖父母
  'greatGrandparent', // 曽祖父母
  'grandchild', // 孫
  'other', // その他（3親等内の親族など）
] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

/** 職業（届書 B⑪・C⑪） */
export const OCCUPATIONS = ['none', 'partTime', 'pensioner', 'child', 'student', 'other'] as const;
export type Occupation = (typeof OCCUPATIONS)[number]; // 無職・パート・年金受給者・小中学生以下・高大学生・その他

/** 扶養に入った理由（配偶者 B⑩／それ以外 C⑬） */
export const SPOUSE_START_REASONS = ['spouseEmployment', 'marriage', 'leftJob', 'incomeDecrease', 'other'] as const;
export const OTHER_START_REASONS = ['birth', 'leftJob', 'incomeDecrease', 'cohabitation', 'other'] as const;
export type DependentStartReason =
  | (typeof SPOUSE_START_REASONS)[number]
  | (typeof OTHER_START_REASONS)[number];

/** 扶養から外れた理由（配偶者 B⑭／それ以外 C⑮。離婚は配偶者だけ） */
export const DEPENDENT_END_REASONS = [
  'death',
  'divorce',
  'employment',
  'incomeIncrease',
  'age75',
  'disability',
  'other',
] as const;
export type DependentEndReason = (typeof DEPENDENT_END_REASONS)[number];

/** 電話の種類（届書 B⑧） */
export const PHONE_TYPES = ['home', 'mobile', 'work', 'other'] as const;
export type PhoneType = (typeof PHONE_TYPES)[number];

/** 海外特例要件に該当した理由（B⑰・C⑧） */
export const OVERSEAS_REASONS = ['study', 'accompany', 'specificActivity', 'marriageAbroad', 'other'] as const;
export type OverseasReason = (typeof OVERSEAS_REASONS)[number];

/** 海外特例要件に該当しなくなった理由（B⑲・C⑨） */
export const OVERSEAS_END_REASONS = ['returned', 'other'] as const;
export type OverseasEndReason = (typeof OVERSEAS_END_REASONS)[number];

/** 年収をどの方法で見込むか（2026-04-01 から、給与だけなら労働契約の内容で判定できる） */
export const INCOME_BASES = ['estimate', 'contract'] as const;
export type IncomeBasis = (typeof INCOME_BASES)[number];

/** 海外特例要件（海外に住んでいても扶養に入れる特例） */
export interface OverseasSpecialDoc {
  reason: OverseasReason;
  reasonText: string | null; // 「その他」のとき
  from: string; // 該当した日
  to: string | null; // 該当しなくなった日（国内に転入した日など）
  endReason: OverseasEndReason | null;
  endReasonText: string | null;
}

/** 労働契約の内容による年収の判定（R10） */
export interface ContractIncomeDoc {
  annualWage: number; // 契約から見込む年収（諸手当・賞与を含む）
  periodEnd: string | null; // 契約期間の終わり（null は期間の定めなし）
  hoursClear: boolean; // 労働時間がはっきり書いてある（「シフト制による」でない）
  allowancesClear: boolean; // 手当の額がはっきり書いてある（「通勤手当有」だけでない）
}

export interface DependentDoc {
  // ① 誰か
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: string;
  sex: Sex | null;
  relationship: Relationship;
  relationshipNote: string | null; // 「その他」のとき（伯父・甥など）
  commonLaw: boolean; // 配偶者で未届（内縁）
  nationality: string | null; // 外国籍のとき国・地域コード（届書 B⑤）
  alias: string | null; // 外国人通称名（B⑥）
  basicPensionNumber: string | null; // 配偶者（第3号被保険者）のとき
  relationshipConfirmed: boolean; // 事業主が戸籍謄本などで続柄を確認した
  /**
   * 日本国籍でなく、在留資格が「特定活動（医療目的）」「特定活動（長期観光）」で滞在している
   * → 日本に住所があっても被扶養者にならない（日本年金機構「外国人従業員を雇用する事業主の方へ」。11/12 に足した）
   */
  visaExcluded: boolean;
  // ② 住まい
  livingTogether: boolean;
  postalCode: string | null;
  address: string | null;
  phone: string | null; // 配偶者のとき
  phoneType: PhoneType | null;
  remittance: number | null; // 別居のとき 1回の仕送り額
  remittanceTimes: number | null; // 年の回数
  overseas: OverseasSpecialDoc | null;
  // ③ 収入と仕事
  occupation: Occupation;
  occupationNote: string | null; // 「その他」の中身
  schoolYear: number | null; // 高・大学生のとき何年生
  annualIncome: number; // 今後1年の年収の見込み（非課税の年金・失業給付・傷病手当金も含む）
  disabled: boolean; // 障害者（上限 180万円）
  incomeBasis: IncomeBasis;
  contractIncome: ContractIncomeDoc | null; // incomeBasis が contract のとき
  // ④ 扶養の期間
  from: string; // 被扶養者になった日
  startReason: DependentStartReason | null; // 資格取得と同時なら空でよい
  startReasonText: string | null;
  to: string | null; // 被扶養者でなくなった日（死亡は翌日）
  endReason: DependentEndReason | null;
  endReasonText: string | null;
  needsConfirmationCard: boolean; // 資格確認書の発行が必要
  note: string | null; // 備考
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Dependent extends DependentDoc {
  id: string;
}

export type DependentInput = Omit<DependentDoc, 'createdAt' | 'updatedAt'>;
