/**
 * 扶養家族のカードの値（文字とチェック）⇔ 保存する形（DependentInput）
 * Angular・Firebase に依存しない純粋な関数
 */
import {
  Dependent,
  DependentEndReason,
  DependentInput,
  DependentStartReason,
  IncomeBasis,
  Occupation,
  OTHER_START_REASONS,
  OverseasEndReason,
  OverseasReason,
  PhoneType,
  Relationship,
  SPOUSE_START_REASONS,
} from '../../../core/models/dependent';
import { Sex } from '../../../core/models/employee';
import { formatYen, parseHours, parseNat } from '../../../shared/utils/number';
import { toHalfWidth } from '../../../shared/utils/text';

export interface DependentFormValue {
  // ① 誰か
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: string;
  sex: Sex | '';
  relationship: Relationship;
  relationshipNote: string;
  commonLaw: boolean;
  nationality: string;
  alias: string;
  basicPensionNumber: string;
  relationshipConfirmed: boolean;
  visaExcluded: boolean;
  // ② 住まい
  livingTogether: boolean;
  postalCode: string;
  address: string;
  phone: string;
  phoneType: PhoneType | '';
  remittance: string;
  remittanceTimes: string;
  hasOverseas: boolean;
  overseasReason: OverseasReason;
  overseasReasonText: string;
  overseasFrom: string;
  overseasTo: string;
  overseasEndReason: OverseasEndReason | '';
  overseasEndReasonText: string;
  // ③ 収入と仕事
  occupation: Occupation;
  occupationNote: string;
  schoolYear: string;
  annualIncome: string;
  monthlyIncome: string; // 保存しない（年収の候補を出す材料）
  disabled: boolean;
  incomeBasis: IncomeBasis;
  contractAnnualWage: string;
  contractPeriodEnd: string;
  contractHoursClear: boolean;
  contractAllowancesClear: boolean;
  contractHourly: string; // 保存しない（契約の年収の候補を出す材料）
  contractWeeklyHours: string; // 同上
  contractAllowances: string; // 同上（月の手当）
  contractBonus: string; // 同上（年の賞与）
  // ④ 扶養の期間
  from: string;
  startReason: DependentStartReason | '';
  startReasonText: string;
  to: string;
  endReason: DependentEndReason | '';
  endReasonText: string;
  needsConfirmationCard: boolean;
  note: string;
}

export type DependentField = keyof DependentFormValue;
export type DependentError =
  | 'required'
  | 'kana'
  | 'postalCode'
  | 'basicPensionNumber'
  | 'country'
  | 'yen'
  | 'times'
  | 'schoolYear'
  | 'toBeforeFrom'
  | 'fromBeforeBirth'
  | 'reasonMismatch';

const KANA = /^[ァ-ヶー・\s　]+$/;
const trimOrNull = (v: string): string | null => (v.trim() ? v.trim() : null);
const digits = (v: string): string => toHalfWidth(v).replace(/[-‐ー－\s]/g, '');
const orNull = <T extends string>(v: T | ''): T | null => (v === '' ? null : v);

/** 扶養に入った理由の選択肢（配偶者とそれ以外で違う） */
export function startReasonsOf(r: Relationship): readonly DependentStartReason[] {
  return r === 'spouse' ? SPOUSE_START_REASONS : OTHER_START_REASONS;
}

// ===== 候補 =====

/** 月額 × 12 */
export function annualFromMonthly(monthly: string): number | null {
  const n = parseNat(monthly);
  return n == null ? null : n * 12;
}

/** 契約から見込む年収：時給 × 週の時間 × 52 ＋ 月の手当 × 12 ＋ 年の賞与（円未満切り捨て） */
export function contractWageCandidate(v: DependentFormValue): number | null {
  const hourly = parseNat(v.contractHourly);
  const weekly = parseHours(v.contractWeeklyHours);
  if (hourly == null || weekly == null) return null;
  const allowances = parseNat(v.contractAllowances) ?? 0;
  const bonus = parseNat(v.contractBonus) ?? 0;
  return Math.floor((hourly * weekly * 52) / 60) + allowances * 12 + bonus;
}

// ===== 初期値 =====

export function emptyDependentForm(from: string): DependentFormValue {
  return {
    lastName: '',
    firstName: '',
    lastNameKana: '',
    firstNameKana: '',
    birthDate: '',
    sex: '',
    relationship: 'spouse',
    relationshipNote: '',
    commonLaw: false,
    nationality: '',
    alias: '',
    basicPensionNumber: '',
    relationshipConfirmed: false,
    visaExcluded: false,
    livingTogether: true,
    postalCode: '',
    address: '',
    phone: '',
    phoneType: '',
    remittance: '',
    remittanceTimes: '12',
    hasOverseas: false,
    overseasReason: 'study',
    overseasReasonText: '',
    overseasFrom: '',
    overseasTo: '',
    overseasEndReason: '',
    overseasEndReasonText: '',
    occupation: 'none',
    occupationNote: '',
    schoolYear: '',
    annualIncome: '0',
    monthlyIncome: '',
    disabled: false,
    incomeBasis: 'estimate',
    contractAnnualWage: '',
    contractPeriodEnd: '',
    contractHoursClear: true,
    contractAllowancesClear: true,
    contractHourly: '',
    contractWeeklyHours: '',
    contractAllowances: '',
    contractBonus: '',
    from,
    startReason: '',
    startReasonText: '',
    to: '',
    endReason: '',
    endReasonText: '',
    needsConfirmationCard: false,
    note: '',
  };
}

export function toDependentForm(d: Dependent | DependentInput): DependentFormValue {
  const o = d.overseas;
  const c = d.contractIncome;
  return {
    ...emptyDependentForm(d.from),
    lastName: d.lastName,
    firstName: d.firstName,
    lastNameKana: d.lastNameKana,
    firstNameKana: d.firstNameKana,
    birthDate: d.birthDate,
    sex: d.sex ?? '',
    relationship: d.relationship,
    relationshipNote: d.relationshipNote ?? '',
    commonLaw: d.commonLaw,
    nationality: d.nationality ?? '',
    alias: d.alias ?? '',
    basicPensionNumber: d.basicPensionNumber ?? '',
    relationshipConfirmed: d.relationshipConfirmed,
    visaExcluded: d.visaExcluded ?? false, // 11/12 より前の文書にはない
    livingTogether: d.livingTogether,
    postalCode: d.postalCode ?? '',
    address: d.address ?? '',
    phone: d.phone ?? '',
    phoneType: d.phoneType ?? '',
    remittance: d.remittance == null ? '' : formatYen(d.remittance),
    remittanceTimes: d.remittanceTimes == null ? '12' : String(d.remittanceTimes),
    hasOverseas: o !== null,
    overseasReason: o?.reason ?? 'study',
    overseasReasonText: o?.reasonText ?? '',
    overseasFrom: o?.from ?? '',
    overseasTo: o?.to ?? '',
    overseasEndReason: o?.endReason ?? '',
    overseasEndReasonText: o?.endReasonText ?? '',
    occupation: d.occupation,
    occupationNote: d.occupationNote ?? '',
    schoolYear: d.schoolYear == null ? '' : String(d.schoolYear),
    annualIncome: formatYen(d.annualIncome),
    disabled: d.disabled,
    incomeBasis: d.incomeBasis,
    contractAnnualWage: c ? formatYen(c.annualWage) : '',
    contractPeriodEnd: c?.periodEnd ?? '',
    contractHoursClear: c?.hoursClear ?? true,
    contractAllowancesClear: c?.allowancesClear ?? true,
    from: d.from,
    startReason: d.startReason ?? '',
    startReasonText: d.startReasonText ?? '',
    to: d.to ?? '',
    endReason: d.endReason ?? '',
    endReasonText: d.endReasonText ?? '',
    needsConfirmationCard: d.needsConfirmationCard,
    note: d.note ?? '',
  };
}

// ===== チェック =====

/** 保存できない理由（欄 → エラー）。空なら保存できる */
export function dependentErrors(v: DependentFormValue): Partial<Record<DependentField, DependentError>> {
  const e: Partial<Record<DependentField, DependentError>> = {};
  const spouse = v.relationship === 'spouse';
  if (!v.lastName.trim()) e.lastName = 'required';
  if (!v.lastNameKana.trim()) e.lastNameKana = 'required';
  else if (!KANA.test(v.lastNameKana)) e.lastNameKana = 'kana';
  if (v.firstNameKana.trim() && !KANA.test(v.firstNameKana)) e.firstNameKana = 'kana';
  if (!v.birthDate) e.birthDate = 'required';
  if (v.relationship === 'other' && !v.relationshipNote.trim()) e.relationshipNote = 'required';

  if (spouse && v.nationality.trim() && !/^[A-Za-z]{2}$/.test(toHalfWidth(v.nationality.trim()))) {
    e.nationality = 'country';
  }
  if (spouse && v.basicPensionNumber.trim() && !/^\d{10}$/.test(digits(v.basicPensionNumber))) {
    e.basicPensionNumber = 'basicPensionNumber';
  }
  if (v.postalCode.trim() && !/^\d{7}$/.test(digits(v.postalCode))) e.postalCode = 'postalCode';

  if (!v.livingTogether) {
    // 別居なら住所は必須（被扶養者（異動）届の住所欄・別居の申立てで要る）
    if (!v.address.trim()) e.address = 'required';
    if (v.remittance.trim() && parseNat(v.remittance) == null) e.remittance = 'yen';
    const t = parseNat(v.remittanceTimes);
    if (v.remittanceTimes.trim() && (t == null || t < 1 || t > 365)) e.remittanceTimes = 'times';
  }
  if (v.hasOverseas) {
    if (!v.overseasFrom) e.overseasFrom = 'required';
    if (v.overseasTo && v.overseasFrom && v.overseasTo < v.overseasFrom) e.overseasTo = 'toBeforeFrom';
  }

  if (v.occupation === 'student') {
    const y = parseNat(v.schoolYear);
    if (v.schoolYear.trim() && (y == null || y < 1 || y > 6)) e.schoolYear = 'schoolYear';
  }
  if (parseNat(v.annualIncome) == null) e.annualIncome = 'yen';
  if (v.incomeBasis === 'contract' && parseNat(v.contractAnnualWage) == null) e.contractAnnualWage = 'yen';

  if (!v.from) e.from = 'required';
  else if (v.birthDate && v.from < v.birthDate) e.from = 'fromBeforeBirth';
  if (v.startReason && !startReasonsOf(v.relationship).includes(v.startReason)) e.startReason = 'reasonMismatch';
  if (v.to) {
    if (v.from && v.to <= v.from) e.to = 'toBeforeFrom';
    if (!v.endReason) e.endReason = 'required';
    else if (v.endReason === 'divorce' && !spouse) e.endReason = 'reasonMismatch';
  }
  return e;
}

// ===== 画面 → 保存する形 =====

/** チェックを通らなければ null。続柄などに関係しない欄は消して保存する */
export function fromDependentForm(v: DependentFormValue): DependentInput | null {
  if (Object.keys(dependentErrors(v)).length > 0) return null;
  const spouse = v.relationship === 'spouse';
  const apart = !v.livingTogether;
  const ended = v.to !== '';
  const pension = digits(v.basicPensionNumber);
  const postal = digits(v.postalCode);
  const phone = toHalfWidth(v.phone).replace(/[^\d+]/g, '');
  return {
    lastName: v.lastName.trim(),
    firstName: v.firstName.trim(),
    lastNameKana: v.lastNameKana.trim(),
    firstNameKana: v.firstNameKana.trim(),
    birthDate: v.birthDate,
    sex: orNull(v.sex),
    relationship: v.relationship,
    relationshipNote: v.relationship === 'other' ? trimOrNull(v.relationshipNote) : null,
    commonLaw: spouse && v.commonLaw,
    nationality: spouse && v.nationality.trim() ? toHalfWidth(v.nationality.trim()).toUpperCase() : null,
    alias: spouse ? trimOrNull(v.alias) : null,
    basicPensionNumber: spouse && pension ? pension : null,
    relationshipConfirmed: v.relationshipConfirmed,
    visaExcluded: v.visaExcluded,
    livingTogether: v.livingTogether,
    postalCode: postal ? postal : null,
    address: trimOrNull(v.address),
    phone: spouse && phone ? phone : null,
    phoneType: spouse && phone ? orNull(v.phoneType) : null,
    remittance: apart ? (parseNat(v.remittance) ?? null) : null,
    remittanceTimes: apart && v.remittance.trim() ? (parseNat(v.remittanceTimes) ?? null) : null,
    overseas: v.hasOverseas
      ? {
          reason: v.overseasReason,
          reasonText: v.overseasReason === 'other' ? trimOrNull(v.overseasReasonText) : null,
          from: v.overseasFrom,
          to: v.overseasTo || null,
          endReason: v.overseasTo ? orNull(v.overseasEndReason) : null,
          endReasonText: v.overseasTo && v.overseasEndReason === 'other' ? trimOrNull(v.overseasEndReasonText) : null,
        }
      : null,
    occupation: v.occupation,
    occupationNote: v.occupation === 'other' ? trimOrNull(v.occupationNote) : null,
    schoolYear: v.occupation === 'student' ? (parseNat(v.schoolYear) ?? null) : null,
    annualIncome: parseNat(v.annualIncome) as number,
    disabled: v.disabled,
    incomeBasis: v.incomeBasis,
    contractIncome:
      v.incomeBasis === 'contract'
        ? {
            annualWage: parseNat(v.contractAnnualWage) as number,
            periodEnd: v.contractPeriodEnd || null,
            hoursClear: v.contractHoursClear,
            allowancesClear: v.contractAllowancesClear,
          }
        : null,
    from: v.from,
    startReason: orNull(v.startReason),
    startReasonText: v.startReason === 'other' ? trimOrNull(v.startReasonText) : null,
    to: ended ? v.to : null,
    endReason: ended ? orNull(v.endReason) : null,
    endReasonText: ended && v.endReason === 'other' ? trimOrNull(v.endReasonText) : null,
    needsConfirmationCard: v.needsConfirmationCard,
    note: trimOrNull(v.note),
  };
}

/** 一覧の並び：扶養に入っている人が上（配偶者 → 生年月日の早い順）、外れた人が下 */
export function sortDependents<T extends Pick<Dependent, 'relationship' | 'birthDate' | 'to'>>(
  rows: T[],
  today: string,
): T[] {
  const active = (d: T) => d.to === null || today < d.to;
  return [...rows].sort((a, b) => {
    if (active(a) !== active(b)) return active(a) ? -1 : 1;
    if ((a.relationship === 'spouse') !== (b.relationship === 'spouse')) return a.relationship === 'spouse' ? -1 : 1;
    return a.birthDate.localeCompare(b.birthDate);
  });
}
