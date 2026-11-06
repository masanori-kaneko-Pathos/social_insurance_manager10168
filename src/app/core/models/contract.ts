import { Timestamp } from 'firebase/firestore';

/**
 * 雇用契約の履歴（offices/{officeId}/employees/{employeeId}/contracts/{from}）
 * ドキュメントID ＝ この契約が始まる日 'YYYY-MM-DD'。契約が変わったら新しい行を足す（上書きしない）
 * 被保険者区分（通常／短時間労働者／特定減額特例対象者／対象外）は保存せず、ここから毎回計算する
 */

export type EmploymentType = 'regular' | 'contract' | 'part' | 'arbeit' | 'shokutaku' | 'other';
export const EMPLOYMENT_TYPES: readonly EmploymentType[] = [
  'regular',
  'contract',
  'part',
  'arbeit',
  'shokutaku',
  'other',
];

/** 給与の形（支払基礎日数の数え方が決まる） */
export type PayType = 'monthly' | 'dailyMonthly' | 'daily' | 'hourly'; // 月給・日給月給・日給・時給
export const PAY_TYPES: readonly PayType[] = ['monthly', 'dailyMonthly', 'daily', 'hourly'];

/** 学生（昼間学生は短時間労働者の対象外。夜間・通信・定時制・休学中は対象） */
export type StudentType = 'none' | 'daytime' | 'other';
export const STUDENT_TYPES: readonly StudentType[] = ['none', 'daytime', 'other'];

/** 雇用期間の更新の見込み */
export type RenewalType = 'none' | 'possible' | 'expected'; // 更新しない・する場合がある・する
export const RENEWAL_TYPES: readonly RenewalType[] = ['none', 'possible', 'expected'];

/** 派遣・請負の区分 */
export type DispatchType = 'none' | 'dispatch' | 'contract';
export const DISPATCH_TYPES: readonly DispatchType[] = ['none', 'dispatch', 'contract'];

export interface ContractDoc {
  from: string; // 'YYYY-MM-DD'（＝ ドキュメントID）
  employmentType: EmploymentType;
  payType: PayType;
  weeklyMinutes: number; // 週の所定労働時間（分）
  monthlyDays: number; // 月の所定労働日数
  /** 所定内賃金（基本給＋諸手当。残業代・賞与・臨時の賃金は除く）。特定減額特例対象者の判定 */
  scheduledWage: number;
  /** 見込みの報酬月額（残業の見込み・通勤手当を含む）。資格取得時決定・取得届 */
  expectedCash: number;
  expectedInKind: number;
  hourlyWage: number | null;
  dailyWage: number | null;
  periodEnd: string | null; // 雇用期間の定めがあるときの終わりの日
  renewal: RenewalType;
  student: StudentType;
  minimumWageReduction: boolean; // 最低賃金の減額の特例許可（最低賃金法第7条）
  dispatch: DispatchType;
  note: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type Contract = Omit<ContractDoc, 'createdAt' | 'updatedAt'>;
export type ContractInput = Contract;
