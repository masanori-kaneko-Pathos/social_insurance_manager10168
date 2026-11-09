/**
 * 雇用契約のカードの値（文字とチェック）⇔ 保存する形（ContractInput）
 * Angular・Firebase に依存しない純粋な関数
 */
import {
  Contract,
  ContractInput,
  DispatchType,
  EmploymentType,
  PayType,
  RenewalType,
  SpecialEmployment,
  StudentType,
} from '../../../core/models/contract';
import { monthsPeriodEnd } from '../../../shared/utils/date';
import { formatHours, formatYen, parseHours, parseNat } from '../../../shared/utils/number';

/**
 * 所定労働時間の入れ方（年金機構の適用拡大 Q&A）
 * - week：週の時間をそのまま
 * - month：月の時間 ÷（52/12）
 * - year：年の時間 ÷ 52
 * - cycle：4週5休などで週ごとに変わる → 周期の時間 ÷ 周期の週数（平均）
 */
export const HOURS_UNITS = ['week', 'month', 'year', 'cycle'] as const;
export type HoursUnit = (typeof HOURS_UNITS)[number];

export const WEEK_MAX_MINUTES = 168 * 60;

export interface ContractFormValue {
  from: string;
  employmentType: EmploymentType;
  payType: PayType;
  hoursUnit: HoursUnit;
  hours: string; // 入れ方の単位での時間（'20'・'20:00'・'86:40'）
  cycleWeeks: string; // 周期の週数（cycle のときだけ）
  monthlyDays: string;
  hourlyWage: string;
  dailyWage: string;
  scheduledWage: string;
  expectedCash: string;
  expectedInKind: string;
  periodEnd: string;
  renewal: RenewalType;
  student: StudentType;
  minimumWageReduction: boolean;
  dispatch: DispatchType;
  specialEmployment: SpecialEmployment;
  renewalPrecedent: boolean;
  noExtensionAgreed: boolean;
  note: string;
}

// ===== 計算の道具 =====

/** 入れた時間 → 週の所定労働時間（分）。空なら null、読めなければ undefined */
export function weeklyMinutesOf(
  unit: HoursUnit,
  hours: string,
  cycleWeeks = '',
): number | null | undefined {
  const m = parseHours(hours);
  if (m === null || m === undefined) return m;
  switch (unit) {
    case 'week':
      return m;
    case 'month':
      return Math.round((m * 12) / 52);
    case 'year':
      return Math.round(m / 52);
    case 'cycle': {
      const w = parseNat(cycleWeeks);
      if (w === null) return null;
      if (w === undefined || w === 0) return undefined;
      return Math.round(m / w);
    }
  }
}

/** 2か月以内の期間を定めた契約か（暦月で数える。Q&A 問8） */
export function isShortPeriod(from: string, periodEnd: string | null): boolean {
  return !!from && !!periodEnd && periodEnd <= monthsPeriodEnd(from, 2);
}

/** 時給・日給の欄を出すか */
export function wageFieldOf(payType: PayType): 'hourlyWage' | 'dailyWage' | null {
  if (payType === 'hourly') return 'hourlyWage';
  if (payType === 'daily') return 'dailyWage';
  return null;
}

/**
 * 所定内賃金の候補（押すと入る。手で直せる）
 * - 時給：時給 × 週の時間 × 52 ÷ 12（円未満は切り捨て）
 * - 日給：日給 × 月の所定労働日数
 * - 月給・日給月給：出さない（基本給＋諸手当を給与の規程から入れる）
 */
export function scheduledWageCandidate(v: ContractFormValue): number | null {
  if (v.payType === 'hourly') {
    const wage = parseNat(v.hourlyWage);
    const weekly = weeklyMinutesOf(v.hoursUnit, v.hours, v.cycleWeeks);
    if (wage == null || weekly == null) return null;
    return Math.floor((wage * weekly * 52) / 60 / 12);
  }
  if (v.payType === 'daily') {
    const wage = parseNat(v.dailyWage);
    const days = parseNat(v.monthlyDays);
    if (wage == null || days == null) return null;
    return wage * days;
  }
  return null;
}

// ===== 初期値 =====

/** 新しい契約（最初の契約は入社日から） */
export function emptyContractForm(from: string): ContractFormValue {
  return {
    from,
    employmentType: 'regular',
    payType: 'monthly',
    hoursUnit: 'week',
    hours: '',
    cycleWeeks: '',
    monthlyDays: '',
    hourlyWage: '',
    dailyWage: '',
    scheduledWage: '',
    expectedCash: '',
    expectedInKind: '0',
    periodEnd: '',
    renewal: 'none',
    student: 'none',
    minimumWageReduction: false,
    dispatch: 'none',
    specialEmployment: 'none',
    renewalPrecedent: false,
    noExtensionAgreed: false,
    note: '',
  };
}

/** 保存した形 → 画面（時間は週で見せる） */
export function toContractForm(c: Contract): ContractFormValue {
  return {
    from: c.from,
    employmentType: c.employmentType,
    payType: c.payType,
    hoursUnit: 'week',
    hours: formatHours(c.weeklyMinutes),
    cycleWeeks: '',
    monthlyDays: String(c.monthlyDays),
    hourlyWage: c.hourlyWage == null ? '' : formatYen(c.hourlyWage),
    dailyWage: c.dailyWage == null ? '' : formatYen(c.dailyWage),
    scheduledWage: formatYen(c.scheduledWage),
    expectedCash: formatYen(c.expectedCash),
    expectedInKind: formatYen(c.expectedInKind),
    periodEnd: c.periodEnd ?? '',
    renewal: c.renewal,
    student: c.student,
    minimumWageReduction: c.minimumWageReduction,
    dispatch: c.dispatch,
    // 11/9 より前の契約には項目がない
    specialEmployment: c.specialEmployment ?? 'none',
    renewalPrecedent: c.renewalPrecedent ?? false,
    noExtensionAgreed: c.noExtensionAgreed ?? false,
    note: c.note ?? '',
  };
}

/** 「契約が変わった」：今の契約を写して、始まる日だけ変える */
export function nextContractForm(current: Contract, from: string): ContractFormValue {
  return { ...toContractForm(current), from };
}

// ===== チェック =====

export type ContractError =
  | 'fromRequired'
  | 'hours'
  | 'hoursRange'
  | 'cycleWeeks'
  | 'days'
  | 'wage'
  | 'scheduledWage'
  | 'expectedCash'
  | 'expectedInKind'
  | 'periodBeforeFrom';

/** 保存できない理由（欄の名前 → エラー）。空なら保存できる */
export function contractErrors(v: ContractFormValue): Partial<Record<keyof ContractFormValue, ContractError>> {
  const e: Partial<Record<keyof ContractFormValue, ContractError>> = {};
  if (!v.from) e.from = 'fromRequired';

  if (v.hoursUnit === 'cycle') {
    const w = parseNat(v.cycleWeeks);
    if (w == null || w === 0 || w > 52) e.cycleWeeks = 'cycleWeeks';
  }
  const weekly = weeklyMinutesOf(v.hoursUnit, v.hours, v.cycleWeeks);
  if (weekly == null) {
    if (!e.cycleWeeks) e.hours = 'hours';
  } else if (weekly > WEEK_MAX_MINUTES) {
    e.hours = 'hoursRange';
  }

  const days = parseNat(v.monthlyDays);
  if (days == null || days > 31) e.monthlyDays = 'days';

  const wageField = wageFieldOf(v.payType);
  if (wageField && parseNat(v[wageField]) == null) e[wageField] = 'wage';

  if (parseNat(v.scheduledWage) == null) e.scheduledWage = 'scheduledWage';
  if (parseNat(v.expectedCash) == null) e.expectedCash = 'expectedCash';
  if (parseNat(v.expectedInKind) == null) e.expectedInKind = 'expectedInKind';

  if (v.from && v.periodEnd && v.periodEnd < v.from) e.periodEnd = 'periodBeforeFrom';
  return e;
}

/** 注意（保存はできる） */
export function contractWarnings(v: ContractFormValue, hireDate: string): ('beforeHire')[] {
  return v.from && hireDate && v.from < hireDate ? ['beforeHire'] : [];
}

// ===== 画面 → 保存する形 =====

/** 画面の値を保存する形に。チェックを通らなければ null */
export function fromContractForm(v: ContractFormValue): ContractInput | null {
  if (Object.keys(contractErrors(v)).length > 0) return null;
  const wageField = wageFieldOf(v.payType);
  const hasPeriod = v.periodEnd !== '';
  const short = isShortPeriod(v.from, v.periodEnd || null);
  return {
    from: v.from,
    employmentType: v.employmentType,
    payType: v.payType,
    weeklyMinutes: weeklyMinutesOf(v.hoursUnit, v.hours, v.cycleWeeks) as number,
    monthlyDays: parseNat(v.monthlyDays) as number,
    scheduledWage: parseNat(v.scheduledWage) as number,
    expectedCash: parseNat(v.expectedCash) as number,
    expectedInKind: parseNat(v.expectedInKind) as number,
    // 給与の形に合わない方の単価は消す
    hourlyWage: wageField === 'hourlyWage' ? (parseNat(v.hourlyWage) as number) : null,
    dailyWage: wageField === 'dailyWage' ? (parseNat(v.dailyWage) as number) : null,
    periodEnd: hasPeriod ? v.periodEnd : null,
    // 期間の定めがなければ「更新」は意味がないので none
    renewal: hasPeriod ? v.renewal : 'none',
    student: v.student,
    minimumWageReduction: v.minimumWageReduction,
    dispatch: v.dispatch,
    specialEmployment: v.specialEmployment,
    // 更新の実績・労使の合意は、2か月以内の契約のときだけ意味がある
    renewalPrecedent: short ? v.renewalPrecedent : false,
    noExtensionAgreed: short ? v.noExtensionAgreed : false,
    note: v.note.trim() ? v.note.trim() : null,
  };
}

/** その日に効いている契約（始まる日がその日以前で、いちばん新しいもの） */
export function contractAt<T extends Pick<Contract, 'from'>>(rows: T[], date: string): T | null {
  let best: T | null = null;
  for (const r of rows) if (r.from <= date && (!best || r.from > best.from)) best = r;
  return best;
}
