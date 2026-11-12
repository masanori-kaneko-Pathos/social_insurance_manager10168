/**
 * 従業員の登録・編集画面の値（文字とチェック）⇔ 保存する形（EmployeeFormInput。保存のときに鍵付きの文書と分ける）
 * Angular・Firebase に依存しない純粋な関数。画面は文字で持ち、「保存する」で変換する
 */
import {
  AccountType,
  AcquisitionType,
  AgreementCovers,
  EmergencyContact,
  EmployeeOrg,
  OFFICER_CHECKS,
  OfficerCheck,
  OfficerType,
  EmployeeFormInput,
  EmployeeFull,
  EnrollmentDoc,
  FilingName,
  ForeignDoc,
  LossReason,
  NameOrder,
  NoAddressReason,
  NoRomanReason,
  PersonName,
  RetireReason,
  Sex,
} from '../../../core/models/employee';
import { CollectionMethod } from '../../../core/models/premium';
import { toHalfWidth } from '../../../shared/utils/text';

// ===== 画面の値 =====

export interface EnrollmentForm {
  enrolled: boolean;
  acquiredDate: string;
  lostDate: string;
  lossReason: LossReason | '';
}

/** 氏・名とフリガナ（住民票の漢字氏名・通称名）。4つとも空なら「なし」 */
export interface PersonNameForm {
  last: string;
  first: string;
  lastKana: string;
  firstKana: string;
}

export interface ForeignForm {
  romanLastName: string;
  romanFirstName: string;
  romanMiddleName: string;
  noRomanReason: NoRomanReason | '';
  noRomanReasonText: string;
  kanjiName: PersonNameForm;
  alias: PersonNameForm;
  filingName: FilingName;
  residentRegistered: boolean;
  needsRomanNameFiling: boolean;
  nationality: string;
  residenceCardNumber: string;
  residenceStatus: string;
  residenceExpiry: string;
  workPermit: boolean;
  workPermitHours: string; // 週の時間（28 など）
  noAddressReason: NoAddressReason | '';
  hasCertificate: boolean;
  certCountry: string;
  certFrom: string;
  certTo: string;
  certCovers: AgreementCovers;
}

export interface EmployeeFormValue {
  employeeNumber: string;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  /** 外国籍でも「カナの読みで並べる」（日本の姓を名乗っている人など） */
  sortByKana: boolean;
  birthDate: string;
  sex: Sex | '';
  hireDate: string;
  retireDate: string;
  retireReason: RetireReason | '';
  health: EnrollmentForm;
  pension: EnrollmentForm;
  acquisitionType: AcquisitionType;
  multipleOffices: boolean;
  rehired: boolean;
  needsConfirmationCard: boolean;
  optInDate: string;
  optOutDate: string;
  insuredNumber: string;
  basicPensionNumber: string;
  contact: {
    postalCode: string;
    address: string;
    /** 居所（住民票と違うときだけ） */
    livingPostalCode: string;
    livingAddress: string;
    /** 海外に住んでいる（住民票を抜いた）ときの国コードと都市 */
    overseasCountry: string;
    overseasCity: string;
    phone: string;
    phoneNote: string;
    /** 2つ目・3つ目の電話（「電話番号を追加」で出す欄） */
    phone2: string;
    phone2Note: string;
    phone3: string;
    phone3Note: string;
    email: string;
    /** 緊急連絡先（1件目・2件目） */
    emergency1Name: string;
    emergency1Relation: string;
    emergency1Phone: string;
    emergency2Name: string;
    emergency2Relation: string;
    emergency2Phone: string;
  };
  commute: { method: string; route: string };
  bankAccount: {
    bankName: string;
    branchName: string;
    accountType: AccountType | '';
    accountNumber: string;
    holderKana: string;
  };
  collectionMethod: CollectionMethod | '';
  /** 部署・役職・役員（11/12） */
  org: OrgForm;
  hasForeign: boolean;
  foreign: ForeignForm;
}

// ===== 部署・役職・役員 =====

export type YesNo = '' | 'yes' | 'no';

export interface OrgForm {
  departmentId: string;
  position: string;
  officerType: OfficerType | '';
  /** 非常勤の役員の6項目（''＝まだ答えていない） */
  checks: Record<OfficerCheck, YesNo>;
}

export function emptyOrgForm(): OrgForm {
  return {
    departmentId: '',
    position: '',
    officerType: '',
    checks: { attendance: '', fewOtherJobs: '', boardMeetings: '', supervision: '', beyondAdvice: '', fairPay: '' },
  };
}

export function orgFormOf(o: EmployeeOrg | null): OrgForm {
  const f = emptyOrgForm();
  if (!o) return f;
  f.departmentId = o.departmentId ?? '';
  f.position = o.position ?? '';
  if (o.officer) {
    f.officerType = o.officer.type;
    for (const k of OFFICER_CHECKS) {
      const v = o.officer.checks[k];
      f.checks[k] = v === true ? 'yes' : v === false ? 'no' : '';
    }
  }
  return f;
}

/** フォーム → 保存する形（どれも空なら null） */
export function orgOf(f: OrgForm): EmployeeOrg | null {
  const departmentId = f.departmentId.trim() || null;
  const position = f.position.trim() || null;
  const officer = f.officerType
    ? {
        type: f.officerType,
        checks: Object.fromEntries(
          OFFICER_CHECKS.map((k) => [k, f.officerType === 'partTime' ? (f.checks[k] === 'yes' ? true : f.checks[k] === 'no' ? false : null) : null]),
        ) as Record<OfficerCheck, boolean | null>,
      }
    : null;
  return departmentId || position || officer ? { departmentId, position, officer } : null;
}

// ===== 小さな道具 =====

const toNull = (v: string): string | null => (v.trim() ? v.trim() : null);
/** 数字だけにする（ハイフン・空白・全角を取る）。空なら null */
const digitsOrNull = (v: string): string | null => {
  const d = toHalfWidth(v).replace(/[-‐ー－\s]/g, '');
  return d ? d : null;
};
const upperOrNull = (v: string): string | null => {
  const t = toHalfWidth(v).trim().toUpperCase();
  return t ? t : null;
};
const orNull = <T extends string>(v: T | ''): T | null => (v === '' ? null : v);
/** 電話番号：数字と先頭の + だけ残す（ハイフン・空白・かっこを取る） */
/** 2つ目・3つ目の電話（番号のない欄は捨てる。備考だけ入っていても残さない） */
function otherPhonesOf(c: Partial<EmployeeFormValue['contact']>): { number: string; note: string | null }[] {
  return [
    [c.phone2, c.phone2Note],
    [c.phone3, c.phone3Note],
  ]
    .map(([n, note]) => ({ number: phoneOrNull(n ?? ''), note: toNull(note ?? '') }))
    .filter((p): p is { number: string; note: string | null } => p.number !== null);
}

/** 緊急連絡先：保存する形 → フォームの欄 */
export function emergencyFormOf(list: readonly EmergencyContact[]): Pick<
  EmployeeFormValue['contact'],
  'emergency1Name' | 'emergency1Relation' | 'emergency1Phone' | 'emergency2Name' | 'emergency2Relation' | 'emergency2Phone'
> {
  const [a, b] = list;
  return {
    emergency1Name: a?.name ?? '',
    emergency1Relation: a?.relation ?? '',
    emergency1Phone: a?.phone ?? '',
    emergency2Name: b?.name ?? '',
    emergency2Relation: b?.relation ?? '',
    emergency2Phone: b?.phone ?? '',
  };
}

/** 緊急連絡先：フォームの欄 → 保存する形（3つとも空の行は捨てる。1件目が空なら2件目を前に詰める） */
export function emergencyContactsOf(c: Partial<EmployeeFormValue['contact']>): EmergencyContact[] {
  return (
    [
      [c.emergency1Name, c.emergency1Relation, c.emergency1Phone],
      [c.emergency2Name, c.emergency2Relation, c.emergency2Phone],
    ] as const
  )
    .map(([name, relation, phone]) => ({
      name: toNull(name ?? ''),
      relation: toNull(relation ?? ''),
      phone: phoneOrNull(phone ?? ''),
    }))
    .filter((x) => x.name !== null || x.relation !== null || x.phone !== null);
}

const phoneOrNull = (v: string): string | null => {
  const t = toHalfWidth(v).replace(/[^\d+]/g, '');
  return t ? t : null;
};
/** ローマ字：半角・大文字・空白を1つに */
const roman = (v: string): string => toHalfWidth(v).trim().replace(/\s+/g, ' ').toUpperCase();

export function emptyPersonNameForm(): PersonNameForm {
  return { last: '', first: '', lastKana: '', firstKana: '' };
}

/** 4つのうち1つでも入っているか */
export function isPersonNameFilled(n: PersonNameForm): boolean {
  return [n.last, n.first, n.lastKana, n.firstKana].some((x) => x.trim() !== '');
}

/** 姓と姓のフリガナがそろっているか（名は姓だけの国のために空でもよい） */
export function isPersonNameComplete(n: PersonNameForm): boolean {
  return n.last.trim() !== '' && n.lastKana.trim() !== '';
}

function personNameDoc(n: PersonNameForm): PersonName | null {
  if (!isPersonNameFilled(n)) return null;
  return { last: n.last.trim(), first: n.first.trim(), lastKana: n.lastKana.trim(), firstKana: n.firstKana.trim() };
}

function personNameForm(n: PersonName | null): PersonNameForm {
  return n ? { ...n } : emptyPersonNameForm();
}

// ===== 初期値（新規登録のとき） =====

function emptyEnrollmentForm(): EnrollmentForm {
  return { enrolled: true, acquiredDate: '', lostDate: '', lossReason: '' };
}

export function emptyForeignForm(): ForeignForm {
  return {
    romanLastName: '',
    romanFirstName: '',
    romanMiddleName: '',
    noRomanReason: '',
    noRomanReasonText: '',
    kanjiName: emptyPersonNameForm(),
    alias: emptyPersonNameForm(),
    filingName: 'roman',
    residentRegistered: true,
    needsRomanNameFiling: false,
    nationality: '',
    residenceCardNumber: '',
    residenceStatus: '',
    residenceExpiry: '',
    workPermit: false,
    workPermitHours: '',
    noAddressReason: '',
    hasCertificate: false,
    certCountry: '',
    certFrom: '',
    certTo: '',
    certCovers: 'pension',
  };
}

export function emptyEmployeeForm(): EmployeeFormValue {
  return {
    employeeNumber: '',
    lastName: '',
    firstName: '',
    lastNameKana: '',
    firstNameKana: '',
    sortByKana: false,
    birthDate: '',
    sex: '',
    hireDate: '',
    retireDate: '',
    retireReason: '',
    health: emptyEnrollmentForm(),
    pension: emptyEnrollmentForm(),
    acquisitionType: 'standard',
    multipleOffices: false,
    rehired: false,
    needsConfirmationCard: false,
    optInDate: '',
    optOutDate: '',
    insuredNumber: '',
    basicPensionNumber: '',
    contact: {
      postalCode: '',
      address: '',
      livingPostalCode: '',
      livingAddress: '',
      overseasCountry: '',
      overseasCity: '',
      phone: '',
      phoneNote: '',
      phone2: '',
      phone2Note: '',
      phone3: '',
      phone3Note: '',
      email: '',
      ...emergencyFormOf([]),
    },
    commute: { method: '', route: '' },
    bankAccount: { bankName: '', branchName: '', accountType: '', accountNumber: '', holderKana: '' },
    collectionMethod: '',
    org: emptyOrgForm(),
    hasForeign: false,
    foreign: emptyForeignForm(),
  };
}

// ===== 保存した形 → 画面 =====

function enrollmentForm(e: EnrollmentDoc): EnrollmentForm {
  return {
    enrolled: e.enrolled,
    acquiredDate: e.acquiredDate ?? '',
    lostDate: e.lostDate ?? '',
    lossReason: e.lossReason ?? '',
  };
}

export function toEmployeeForm(e: EmployeeFull): EmployeeFormValue {
  const f = e.foreign;
  const c = f?.certificate ?? null;
  return {
    employeeNumber: e.employeeNumber ?? '',
    lastName: e.lastName,
    firstName: e.firstName,
    lastNameKana: e.lastNameKana,
    firstNameKana: e.firstNameKana,
    sortByKana: f !== null && e.nameOrder === 'kana',
    birthDate: e.birthDate,
    sex: e.sex ?? '',
    hireDate: e.hireDate,
    retireDate: e.retireDate ?? '',
    retireReason: e.retireReason ?? '',
    health: enrollmentForm(e.health),
    pension: enrollmentForm(e.pension),
    acquisitionType: e.acquisitionType,
    multipleOffices: e.multipleOffices,
    rehired: e.rehired,
    needsConfirmationCard: e.needsConfirmationCard,
    optInDate: e.optInDate ?? '',
    optOutDate: e.optOutDate ?? '', // 11/9 より前のデータにはない
    insuredNumber: e.insuredNumber ?? '',
    basicPensionNumber: e.basicPensionNumber ?? '',
    contact: {
      postalCode: e.contact.postalCode ?? '',
      address: e.contact.address ?? '',
      livingPostalCode: e.contact.livingPostalCode ?? '',
      livingAddress: e.contact.livingAddress ?? '',
      overseasCountry: e.contact.overseasCountry ?? '',
      overseasCity: e.contact.overseasCity ?? '',
      phone: e.contact.phone ?? '',
      phoneNote: e.contact.phoneNote ?? '',
      phone2: e.contact.otherPhones?.[0]?.number ?? '',
      phone2Note: e.contact.otherPhones?.[0]?.note ?? '',
      phone3: e.contact.otherPhones?.[1]?.number ?? '',
      phone3Note: e.contact.otherPhones?.[1]?.note ?? '',
      email: e.contact.email ?? '',
      ...emergencyFormOf(e.contact.emergencyContacts ?? []),
    },
    commute: { method: e.commute.method ?? '', route: e.commute.route ?? '' },
    bankAccount: {
      bankName: e.bankAccount.bankName ?? '',
      branchName: e.bankAccount.branchName ?? '',
      accountType: e.bankAccount.accountType ?? '',
      accountNumber: e.bankAccount.accountNumber ?? '',
      holderKana: e.bankAccount.holderKana ?? '',
    },
    collectionMethod: e.collectionMethod ?? '',
    org: orgFormOf(e.org ?? null),
    hasForeign: f !== null,
    foreign: f
      ? {
          romanLastName: f.romanLastName ?? '',
          romanFirstName: f.romanFirstName ?? '',
          romanMiddleName: f.romanMiddleName ?? '',
          noRomanReason: f.noRomanReason ?? '',
          noRomanReasonText: f.noRomanReasonText ?? '',
          kanjiName: personNameForm(f.kanjiName),
          alias: personNameForm(f.alias),
          filingName: f.filingName,
          residentRegistered: f.residentRegistered,
          needsRomanNameFiling: f.needsRomanNameFiling,
          nationality: f.nationality,
          residenceCardNumber: f.residenceCardNumber ?? '',
          residenceStatus: f.residenceStatus ?? '',
          residenceExpiry: f.residenceExpiry ?? '',
          workPermit: f.workPermit,
          workPermitHours:
            f.workPermitWeeklyMinutes == null ? '' : String(f.workPermitWeeklyMinutes / 60),
          noAddressReason: f.noAddressReason ?? '',
          hasCertificate: c !== null,
          certCountry: c?.country ?? '',
          certFrom: c?.from ?? '',
          certTo: c?.to ?? '',
          certCovers: c?.covers ?? 'pension',
        }
      : emptyForeignForm(),
  };
}

// ===== 画面 → 保存する形 =====

function enrollmentDoc(e: EnrollmentForm): EnrollmentDoc {
  return {
    enrolled: e.enrolled,
    acquiredDate: toNull(e.acquiredDate),
    lostDate: toNull(e.lostDate),
    lossReason: e.lostDate.trim() ? orNull(e.lossReason) : null, // 喪失日がなければ原因も消す
  };
}

/** 週の時間（'28'・'27.5'）→ 分。読めなければ null */
export function hoursToMinutes(v: string): number | null {
  const t = toHalfWidth(v).trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 60);
}

function foreignDoc(f: ForeignForm): ForeignDoc {
  const romanLast = roman(f.romanLastName);
  return {
    romanLastName: romanLast || null,
    romanFirstName: roman(f.romanFirstName) || null,
    romanMiddleName: roman(f.romanMiddleName) || null,
    // ローマ字氏名があれば「ない理由」は消す
    noRomanReason: romanLast ? null : orNull(f.noRomanReason),
    noRomanReasonText: !romanLast && f.noRomanReason === 'other' ? toNull(f.noRomanReasonText) : null,
    kanjiName: personNameDoc(f.kanjiName),
    alias: personNameDoc(f.alias),
    filingName: f.filingName,
    residentRegistered: f.residentRegistered,
    needsRomanNameFiling: f.needsRomanNameFiling,
    nationality: upperOrNull(f.nationality) ?? '',
    residenceCardNumber: upperOrNull(f.residenceCardNumber),
    residenceStatus: toNull(f.residenceStatus),
    residenceExpiry: toNull(f.residenceExpiry),
    workPermit: f.workPermit,
    workPermitWeeklyMinutes: f.workPermit ? hoursToMinutes(f.workPermitHours) : null,
    certificate: f.hasCertificate
      ? {
          country: upperOrNull(f.certCountry) ?? '',
          from: f.certFrom,
          to: toNull(f.certTo),
          covers: f.certCovers,
        }
      : null,
    noAddressReason: orNull(f.noAddressReason),
  };
}

/**
 * 届書に使う氏名（EmployeeDoc の lastName・firstName）
 * 外国籍は「取得届などに使う氏名」を写す。ローマ字は名にミドルネームを続ける。ローマ字がなければカナ
 */
export function filingNameOf(
  f: ForeignDoc,
  kana: { lastNameKana: string; firstNameKana: string },
): { lastName: string; firstName: string } {
  if (f.filingName === 'kanji' && f.kanjiName) return { lastName: f.kanjiName.last, firstName: f.kanjiName.first };
  if (f.filingName === 'alias' && f.alias) return { lastName: f.alias.last, firstName: f.alias.first };
  if (f.romanLastName) {
    const first = [f.romanFirstName, f.romanMiddleName].filter(Boolean).join(' ');
    return { lastName: f.romanLastName, firstName: first };
  }
  return { lastName: kana.lastNameKana, firstName: kana.firstNameKana };
}

export function fromEmployeeForm(v: EmployeeFormValue): EmployeeFormInput {
  const foreign = v.hasForeign ? foreignDoc(v.foreign) : null;
  const kana = { lastNameKana: v.lastNameKana.trim(), firstNameKana: v.firstNameKana.trim() };
  const name = foreign
    ? filingNameOf(foreign, kana)
    : { lastName: v.lastName.trim(), firstName: v.firstName.trim() };
  const nameOrder: NameOrder = foreign && !v.sortByKana ? 'roman' : 'kana';
  return {
    employeeNumber: toNull(toHalfWidth(v.employeeNumber)),
    ...name,
    ...kana,
    nameOrder,
    birthDate: v.birthDate,
    sex: orNull(v.sex),
    hireDate: v.hireDate,
    retireDate: toNull(v.retireDate),
    retireReason: v.retireDate.trim() ? orNull(v.retireReason) : null, // 退職日がなければ理由も消す
    health: enrollmentDoc(v.health),
    pension: enrollmentDoc(v.pension),
    acquisitionType: v.acquisitionType,
    multipleOffices: v.multipleOffices,
    rehired: v.rehired,
    needsConfirmationCard: v.needsConfirmationCard,
    optInDate: toNull(v.optInDate),
    optOutDate: toNull(v.optOutDate),
    insuredNumber: toNull(toHalfWidth(v.insuredNumber)),
    basicPensionNumber: digitsOrNull(v.basicPensionNumber),
    contact: {
      postalCode: digitsOrNull(v.contact.postalCode),
      address: toNull(v.contact.address),
      livingPostalCode: digitsOrNull(v.contact.livingPostalCode ?? ''),
      livingAddress: toNull(v.contact.livingAddress ?? ''),
      overseasCountry: upperOrNull(v.contact.overseasCountry ?? ''),
      overseasCity: toNull(v.contact.overseasCity ?? ''),
      phone: phoneOrNull(v.contact.phone),
      phoneNote: toNull(v.contact.phoneNote ?? ''),
      otherPhones: otherPhonesOf(v.contact),
      email: toNull(toHalfWidth(v.contact.email)),
      emergencyContacts: emergencyContactsOf(v.contact),
    },
    commute: { method: toNull(v.commute.method), route: toNull(v.commute.route) },
    bankAccount: {
      bankName: toNull(v.bankAccount.bankName),
      branchName: toNull(v.bankAccount.branchName),
      accountType: orNull(v.bankAccount.accountType),
      accountNumber: digitsOrNull(v.bankAccount.accountNumber),
      holderKana: toNull(v.bankAccount.holderKana),
    },
    collectionMethod: orNull(v.collectionMethod),
    org: orgOf(v.org ?? emptyOrgForm()),
    foreign,
  };
}

// ===== 入力のチェック（形式。日付の前後関係は画面のチェックで見る） =====

export const PATTERNS = {
  kana: /^[ァ-ヶー・\s　]+$/,
  // ハイフン・空白は打っても受け付ける（保存のときに取る）
  postalCode: /^\d{3}[-‐ー－\s]?\d{4}$/,
  basicPensionNumber: /^\d{4}[-‐ー－\s]?\d{6}$/,
  // 銀行の口座番号は7桁（ゆうちょ銀行も、振込用の店名・口座番号は7桁）
  accountNumber: /^\d{7}$/,
  // 口座名義：全角カタカナ・スペースと、名義に使う記号（括弧・ピリオド・ハイフン）
  holderKana: /^[ァ-ヶー\s　（）().．\-‐・]+$/,
  phone: /^\+?[\d\-‐ー－()（）\s]{6,24}$/,
  roman: /^[A-Za-z][A-Za-z'.\-\s]*$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  country: /^[A-Za-zＡ-Ｚａ-ｚ]{2}$/,
  residenceCard: /^[A-Za-z]{2}\d{8}[A-Za-z]{2}$/,
  hours: /^\d{1,3}(\.\d{1,2})?$/,
} as const;
