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
  /** 電話の備考（本人携帯・自宅 など。11/11 に足した。前の文書にはない） */
  phoneNote?: string | null;
  /** 2つ目からの電話（「電話番号を追加」で足す。2つまで。前の文書にはない） */
  otherPhones?: { number: string; note: string | null }[];
  email: string | null; // マイページの招待にも使う
  /** 緊急連絡先（2件まで。11/12 に足した。前の文書にはない） */
  emergencyContacts?: EmergencyContact[];
}

export interface EmergencyContact {
  name: string | null;
  /** 続柄（父・配偶者 など） */
  relation: string | null;
  phone: string | null;
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

/** 介護保険の適用除外の事由（介護保険適用除外等該当・非該当届） */
export type CareExemptionReason = 'overseas' | 'facility' | 'residenceStatus'; // 国外居住・適用除外施設・在留3か月以下
export const CARE_EXEMPTION_REASONS: readonly CareExemptionReason[] = ['overseas', 'facility', 'residenceStatus'];

/** 介護保険の適用除外（40〜64歳でも介護保険料がかからない期間） */
export interface CareExemption {
  reason: CareExemptionReason;
  from: string; // 該当年月日（届書のとおり）
  to: string | null; // 非該当年月日（日本に戻った・退所した など）
  filedOn: string | null; // 該当届を出した日
  endFiledOn: string | null; // 非該当届を出した日
  note: string | null;
}

/** 一覧で並ぶ列：あ〜わ（カナ）か A〜Z（ローマ字） */
export const NAME_ORDERS = ['kana', 'roman'] as const;
export type NameOrder = (typeof NAME_ORDERS)[number];

/** ローマ字氏名がない理由（ローマ字氏名届の C 欄） */
export const NO_ROMAN_REASONS = ['shortStay', 'overseas', 'notOnCard', 'other'] as const;
export type NoRomanReason = (typeof NO_ROMAN_REASONS)[number];

/** 資格取得届などに使う氏名（ローマ字氏名届の「関連届書使用氏名」） */
export const FILING_NAMES = ['roman', 'kanji', 'alias'] as const;
export type FilingName = (typeof FILING_NAMES)[number];

/** 氏・名とそれぞれのフリガナ（住民票の漢字氏名・通称名） */
export interface PersonName {
  last: string;
  first: string;
  lastKana: string;
  firstKana: string;
}

/** 外国人の情報（該当者だけ。日本人は null） */
export interface ForeignDoc {
  // 氏名（ローマ字氏名届の A・B 欄）
  romanLastName: string | null; // 在留カードのとおり。大文字
  romanFirstName: string | null;
  romanMiddleName: string | null; // ミドルネーム・父称など
  noRomanReason: NoRomanReason | null; // ローマ字氏名がないとき
  noRomanReasonText: string | null; // 「その他」の理由
  kanjiName: PersonName | null; // 住民票の漢字氏名（任意）
  alias: PersonName | null; // 住民票の通称名（任意）
  filingName: FilingName; // 取得届などに使う氏名
  residentRegistered: boolean; // 住民登録の有無
  needsRomanNameFiling: boolean; // ローマ字氏名届が要る（個人番号と基礎年金番号が結びついていない等）
  // 在留
  nationality: string; // 国・地域コード
  residenceCardNumber: string | null;
  residenceStatus: string | null; // 在留資格
  residenceExpiry: string | null; // 在留期間の満了日
  workPermit: boolean; // 資格外活動許可
  workPermitWeeklyMinutes: number | null; // 許可の時間（週28時間 ＝ 1680）
  certificate: CertificateDoc | null;
  noAddressReason: NoAddressReason | null;
}

/** 養育する子の区分（育児休業等取得者申出書 ⑧） */
export const CHILD_TYPES = ['natural', 'other'] as const; // 実子・その他（養子など）
export type ChildType = (typeof CHILD_TYPES)[number];

/** 最後に出した届の中身（今の中身と比べて、変更届・延長・終了届が要るかを出す） */
export interface FiledLeave {
  filedOn: string; // 届を出した日
  start: string;
  plannedEnd: string | null;
  end: string | null;
  expectedBirthDate: string | null;
  birthDate: string | null;
  multipleBirth: boolean;
}

/**
 * 休業（産前産後休業取得者申出書 2273・育児休業等取得者申出書 2263 の欄に合わせる）
 * 保険料の免除は「終了日、なければ終了予定日」で計算する。両方なければ「未定」
 */
export interface Leave {
  kind: LeaveKind;
  start: string; // 'YYYY-MM-DD'
  plannedEnd: string | null; // 終了予定日
  end: string | null; // 実際に終わった日（予定より早く終わったときなど。予定どおりなら空でよい）
  /** 産休：出産予定日・出産日・多胎（産前は42日、多胎は98日） */
  expectedBirthDate: string | null;
  birthDate: string | null;
  multipleBirth: boolean;
  /** 育休・出生時育休：養育する子 */
  child: PersonName | null;
  childBirthDate: string | null;
  childType: ChildType | null;
  custodyStart: string | null; // 養育開始日（実子以外）
  papaMamaPlus: boolean; // パパ・ママ育休プラス
  /** 育休・出生時育休：就業予定日数（月の中で終わる育休の14日の数え方から除く） */
  workDays: number | null;
  note: string | null;
  filed: FiledLeave | null;
}

// ===== 従業員 =====

/** Firestore の offices/{officeId}/employees/{employeeId} */
export interface EmployeeDoc {
  // 基本
  employeeNumber: string | null;
  /** 届書に使う氏名。外国籍は「取得届などに使う氏名」（ローマ字・漢字・通称のどれか）を写す */
  lastName: string;
  firstName: string;
  /** 届書のフリガナ（年金機構の通知はこのカナで届く） */
  lastNameKana: string;
  firstNameKana: string;
  nameOrder: NameOrder; // 一覧で並ぶ列（日本国籍は kana、外国籍は roman が初期値）
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
  optOutDate: string | null; // 特定減額特例対象者が喪失を申し出た日（任意の喪失）
  // 届出の番号
  insuredNumber: string | null; // 被保険者整理番号（年金事務所から通知される）
  basicPensionNumber: string | null; // 基礎年金番号（10桁）
  // そのほか（カタログ「利用にあたって 4」）。連絡先・通勤・口座は鍵付きの文書（EmployeePrivateDoc）
  collectionMethod: CollectionMethod | null; // null ＝ 事業所の設定のまま
  foreign: ForeignDoc | null;
  leaves: Leave[];
  /** 介護保険の適用除外（古い文書にはない＝ 空とみなす） */
  careExemptions?: CareExemption[];
  // 扶養家族の判定と届書の材料（扶養家族のカードで入れる）
  /** 被保険者の今後1年の年収の見込み。null なら給与・賞与の実績から計算する（届書 A⑦） */
  annualIncomeEstimate: number | null;
  /** 扶養に入っていない配偶者の年収（届書 ㉑。夫婦のどちらの扶養かを確かめる材料） */
  spouseAnnualIncome: number | null;
  /** マイページのアカウント（まだなら null） */
  userUid: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Employee extends EmployeeDoc {
  id: string;
}

export type EmployeeInput = Omit<EmployeeDoc, 'createdAt' | 'updatedAt'>;

// ===== 鍵付きの文書 offices/{o}/employees/{e}/details/private =====
// 連絡先・通勤・口座。読めるのは管理者と本人だけ（一般ユーザーには見せない）。
// 一覧・To-do・保険料では使わないので、従業員の文書から分けても読み込みは増えない（詳細・編集・マイページで1回ずつ）

export const PRIVATE_KEYS = ['contact', 'commute', 'bankAccount'] as const;

export interface EmployeePrivateDoc {
  contact: ContactDoc;
  commute: CommuteDoc;
  bankAccount: BankAccountDoc;
  updatedAt: Timestamp;
}

export type EmployeePrivate = Omit<EmployeePrivateDoc, 'updatedAt'>;

/** 従業員の文書＋鍵付きの文書（詳細・編集・マイページ・依頼の確認で使う） */
export type EmployeeFull = Employee & EmployeePrivate;

/** 登録・編集画面が扱う項目のうち、従業員の文書に入るもの（休業はカード、マイページのアカウントは招待で保存する） */
export type EmployeeBasicInput = Omit<
  EmployeeInput,
  'leaves' | 'careExemptions' | 'userUid' | 'annualIncomeEstimate' | 'spouseAnnualIncome'
>;

/** 登録・編集画面の保存する形（従業員の文書＋鍵付きの文書。保存のときに分ける） */
export type EmployeeFormInput = EmployeeBasicInput & EmployeePrivate;

// ===== 初期値 =====

export function emptyEnrollment(): EnrollmentDoc {
  return { enrolled: false, acquiredDate: null, lostDate: null, lossReason: null };
}

export function emptyContact(): ContactDoc {
  return {
    postalCode: null,
    address: null,
    phone: null,
    phoneNote: null,
    otherPhones: [],
    email: null,
    emergencyContacts: [],
  };
}

export function emptyBankAccount(): BankAccountDoc {
  return { bankName: null, branchName: null, accountType: null, accountNumber: null, holderKana: null };
}

export function emptyCommute(): CommuteDoc {
  return { method: null, route: null };
}

export function emptyPrivate(): EmployeePrivate {
  return { contact: emptyContact(), commute: emptyCommute(), bankAccount: emptyBankAccount() };
}

/** 鍵付きの文書の項目と、それ以外に分ける（渡された項目だけ） */
export function splitPrivate<T extends Partial<EmployeePrivate>>(
  input: T,
): { main: Omit<T, keyof EmployeePrivate>; priv: Partial<EmployeePrivate> } {
  const main: Record<string, unknown> = {};
  const priv: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if ((PRIVATE_KEYS as readonly string[]).includes(k)) priv[k] = v;
    else main[k] = v;
  }
  return { main: main as Omit<T, keyof EmployeePrivate>, priv: priv as Partial<EmployeePrivate> };
}

/** 古い文書（分ける前）に残っている連絡先などを、鍵付きの文書の形で取り出す（移し替えの前でも表示できるように） */
export function legacyPrivate(e: object): EmployeePrivate | null {
  const o = e as Partial<EmployeePrivate>;
  if (!o.contact && !o.commute && !o.bankAccount) return null;
  const empty = emptyPrivate();
  return {
    contact: o.contact ?? empty.contact,
    commute: o.commute ?? empty.commute,
    bankAccount: o.bankAccount ?? empty.bankAccount,
  };
}

export function emptyLeave(kind: LeaveKind, start: string): Leave {
  return {
    kind,
    start,
    plannedEnd: null,
    end: null,
    expectedBirthDate: null,
    birthDate: null,
    multipleBirth: false,
    child: null,
    childBirthDate: null,
    childType: null,
    custodyStart: null,
    papaMamaPlus: false,
    workDays: null,
    note: null,
    filed: null,
  };
}

/** 登録画面が扱わない項目の初期値（登録のときに係が足す） */
export function employeeExtras(): Omit<EmployeeInput, keyof EmployeeBasicInput> {
  return { leaves: [], careExemptions: [], userUid: null, annualIncomeEstimate: null, spouseAnnualIncome: null };
}
