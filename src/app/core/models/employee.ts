import { Timestamp } from 'firebase/firestore';
import { CollectionMethod } from './premium';

/**
 * 従業員（offices/{officeId}/employees/{employeeId}）
 * 名前の決まり：〜Doc ＝ 保存する形 ／ 何もつけない ＝ アプリの中の形（＋ID） ／ 〜Input ＝ 画面から保存する形
 * 判定（被保険者区分・介護保険の対象・70歳以上被用者など）は保存せず、毎回計算する
 */

// ===== 選択肢 =====

export type Sex = 'male' | 'female';
export const SEXES: readonly Sex[] = ['male', 'female'];

/** 退職の理由（70歳以上被用者不該当届・喪失届の原因の材料） */
export type RetireReason = 'resign' | 'death' | 'transfer' | 'other';
export const RETIRE_REASONS: readonly RetireReason[] = ['resign', 'death', 'transfer', 'other'];

/** 資格喪失の原因（資格喪失届：退職等・死亡・75歳到達・障害認定・社会保障協定） */
export type LossReason = 'retire' | 'death' | 'age75' | 'disability' | 'agreement';
export const LOSS_REASONS: readonly LossReason[] = ['retire', 'death', 'age75', 'disability', 'agreement'];

/** 取得区分（資格取得届：健保・厚年／共済出向／船保任継） */
export type AcquisitionType = 'standard' | 'mutualAidLoan' | 'seamenContinued';
export const ACQUISITION_TYPES: readonly AcquisitionType[] = ['standard', 'mutualAidLoan', 'seamenContinued'];

/** 休業の種類（産休・育休・出生時育休は保険料の免除あり。介護休業・休職は免除なし） */
export type LeaveKind = 'maternity' | 'childcare' | 'paternity' | 'care' | 'suspension';
export const LEAVE_KINDS: readonly LeaveKind[] = ['maternity', 'childcare', 'paternity', 'care', 'suspension'];

export type AccountType = 'ordinary' | 'current' | 'savings'; // 普通・当座・貯蓄
export const ACCOUNT_TYPES: readonly AccountType[] = ['ordinary', 'current', 'savings'];

/** 住所を書けない理由（外国人：海外在住・短期在留・その他） */
export type NoAddressReason = 'overseas' | 'shortStay' | 'other';
export const NO_ADDRESS_REASONS: readonly NoAddressReason[] = ['overseas', 'shortStay', 'other'];

/** 社会保障協定の適用証明書がカバーする範囲 */
export type AgreementCovers = 'pension' | 'pensionAndHealth';
export const AGREEMENT_COVERS: readonly AgreementCovers[] = ['pension', 'pensionAndHealth'];

// ===== まとまり =====

/** 資格（健康保険・厚生年金それぞれ） */
export interface EnrollmentDoc {
  enrolled: boolean;
  acquiredDate: string | null; // 'YYYY-MM-DD'
  lostDate: string | null;
  lossReason: LossReason | null;
}

export interface ContactDoc {
  postalCode: string | null; // 7桁
  address: string | null;
  phone: string | null;
  email: string | null; // マイページの招待にも使う
}

export interface CommuteDoc {
  method: string | null; // 電車・バス・車 など
  route: string | null;
}

export interface BankAccountDoc {
  bankName: string | null;
  branchName: string | null;
  accountType: AccountType | null;
  accountNumber: string | null;
  holderKana: string | null;
}

/** 相手国の適用証明書（社会保障協定） */
export interface CertificateDoc {
  country: string; // 国・地域コード（ISO 3166-1 alpha-2）
  from: string; // 'YYYY-MM-DD'
  to: string | null;
  covers: AgreementCovers;
}

/** 外国人の情報（該当者だけ。日本人は null） */
export interface ForeignDoc {
  romanName: string;
  middleName: string | null;
  nationality: string; // 国・地域コード
  residenceCardNumber: string | null;
  residenceStatus: string | null; // 在留資格
  residenceExpiry: string | null; // 在留期間の満了日
  workPermit: boolean; // 資格外活動許可
  workPermitWeeklyMinutes: number | null; // 許可の時間（週28時間 ＝ 1680）
  certificate: CertificateDoc | null;
  noAddressReason: NoAddressReason | null;
}

/** 休業（終了日 null は「未定」） */
export interface Leave {
  kind: LeaveKind;
  start: string; // 'YYYY-MM-DD'
  end: string | null;
  /** 産休：出産予定日・出産日・多胎（産前は42日、多胎は98日） */
  expectedBirthDate: string | null;
  birthDate: string | null;
  multipleBirth: boolean;
  /** 育休・出生時育休：子の氏名・生年月日 */
  childName: string | null;
  childBirthDate: string | null;
  /** 出生時育休：休業中に働いた日数（14日の数え方から除く） */
  workDays: number | null;
}

// ===== 従業員 =====

/** Firestore の offices/{officeId}/employees/{employeeId} */
export interface EmployeeDoc {
  // 基本
  employeeNumber: string | null;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: string;
  sex: Sex | null;
  // 在籍
  hireDate: string;
  retireDate: string | null;
  retireReason: RetireReason | null;
  // 資格
  health: EnrollmentDoc;
  pension: EnrollmentDoc;
  acquisitionType: AcquisitionType;
  multipleOffices: boolean; // 二以上事業所勤務
  rehired: boolean; // 退職後の継続再雇用（同日得喪）で取得した
  needsConfirmationCard: boolean; // 資格確認書の発行が必要
  optInDate: string | null; // 特定減額特例対象者が加入を申し出た日
  // 届出の番号
  insuredNumber: string | null; // 被保険者整理番号（年金事務所から通知される）
  basicPensionNumber: string | null; // 基礎年金番号（10桁）
  // そのほか（カタログ「利用にあたって 4」）
  contact: ContactDoc;
  commute: CommuteDoc;
  bankAccount: BankAccountDoc;
  collectionMethod: CollectionMethod | null; // null ＝ 事業所の設定のまま
  foreign: ForeignDoc | null;
  leaves: Leave[];
  /** マイページのアカウント（まだなら null） */
  userUid: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Employee extends EmployeeDoc {
  id: string;
}

export type EmployeeInput = Omit<EmployeeDoc, 'createdAt' | 'updatedAt'>;

/** 今の登録・編集画面が扱う項目（それ以外はまとまりごとのカードで保存する） */
export type EmployeeBasicInput = Pick<
  EmployeeInput,
  | 'employeeNumber'
  | 'lastName'
  | 'firstName'
  | 'lastNameKana'
  | 'firstNameKana'
  | 'birthDate'
  | 'hireDate'
  | 'retireDate'
  | 'health'
  | 'pension'
>;

// ===== 初期値 =====

export function emptyEnrollment(): EnrollmentDoc {
  return { enrolled: false, acquiredDate: null, lostDate: null, lossReason: null };
}

export function emptyContact(): ContactDoc {
  return { postalCode: null, address: null, phone: null, email: null };
}

export function emptyBankAccount(): BankAccountDoc {
  return { bankName: null, branchName: null, accountType: null, accountNumber: null, holderKana: null };
}

export function emptyLeave(kind: LeaveKind, start: string): Leave {
  return {
    kind,
    start,
    end: null,
    expectedBirthDate: null,
    birthDate: null,
    multipleBirth: false,
    childName: null,
    childBirthDate: null,
    workDays: null,
  };
}

/** 登録画面が扱わない項目の初期値（登録のときに係が足す） */
export function employeeExtras(): Omit<EmployeeInput, keyof EmployeeBasicInput> {
  return {
    sex: null,
    retireReason: null,
    acquisitionType: 'standard',
    multipleOffices: false,
    rehired: false,
    needsConfirmationCard: false,
    optInDate: null,
    insuredNumber: null,
    basicPensionNumber: null,
    contact: emptyContact(),
    commute: { method: null, route: null },
    bankAccount: emptyBankAccount(),
    collectionMethod: null,
    foreign: null,
    leaves: [],
    userUid: null,
  };
}
