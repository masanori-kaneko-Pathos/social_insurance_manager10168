// 従業員データの書き出し（11/16）
// Angular・Firebase に依存しない純粋な関数
//
// - 列・見出し・値の書き方は、従業員の取り込み（employee-csv.ts）と同じ。新しい事業所・別の環境へ「新規として」取り込み直せる
//   （登録済みの人を取り込みで上書きする機能はない。同じ事業所へ取り込むと「すでに登録されています」になる）
// - マイナンバーは書き出さない（空欄。マイナンバーは別の窓口で扱う）
// - 契約は基準日に効いているもの、休業は新しい2件、報酬月額は資格取得時決定の記録（なければ空）

import type { Contract } from '../../../core/models/contract';
import type { Employee, EmployeePrivate, Leave } from '../../../core/models/employee';
import type { RemunerationDoc } from '../../../core/models/remuneration';
import { EMPLOYEE_COLUMNS, EMPLOYEE_CSV_HEADERS, EmployeeColumn } from './employee-csv';
import { historyText } from './labor-register';

export interface EmployeeExportItem {
  employee: Employee;
  /** 基準日に効いている契約（なければ null） */
  contract: Contract | null;
  remunerations: readonly Pick<RemunerationDoc, 'from' | 'reason' | 'monthlyAmount'>[];
  /** 鍵付きの文書（住所・労働者名簿の履歴など。読めなければ null → 空欄。11/24） */
  private?: Pick<EmployeePrivate, 'contact' | 'register'> | null;
}

// 取り込みで読める言葉（employee-csv.ts の辞書の最初の言い方）
const SEX = { male: '男', female: '女' } as const;
const RETIRE = { resign: '退職', dismissal: '解雇', death: '死亡', transfer: '転勤', other: 'その他' } as const;
const EMPLOYMENT = { regular: '正社員', contract: '契約社員', part: 'パート', arbeit: 'アルバイト', shokutaku: '嘱託', other: 'その他' } as const;
const PAY = { monthly: '月給', dailyMonthly: '日給月給', daily: '日給', hourly: '時給' } as const;
const RENEWAL = { none: 'しない', possible: 'する場合がある', expected: 'する' } as const;
const STUDENT = { none: 'いいえ', daytime: '昼間', other: '夜間・通信・定時制・休学中' } as const;
const SPECIAL = { none: 'ふつう', daily: '日雇い', seasonal: '季節的業務', temporaryBusiness: '臨時的事業' } as const;
const LEAVE = { maternity: '産休', childcare: '育休', paternity: '出生時育休', care: '介護休業', suspension: '休職' } as const;

const yn = (b: boolean) => (b ? 'はい' : 'いいえ');
const num = (n: number | null | undefined) => (n == null ? '' : String(n));

/** 分 → 'H:MM'（2400 → '40:00'） */
export function hoursText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** 休業の1件 → 5つの列（種類・開始日・終了日・出産日／子の生年月日・申出日） */
function leaveCells(l: Leave | undefined): [string, string, string, string, string] {
  if (!l) return ['', '', '', '', ''];
  const birth = l.kind === 'maternity' ? (l.birthDate ?? l.expectedBirthDate) : l.childBirthDate;
  // 申出日：日付／申出済み・日付不明は空／申出がまだは「未申出」（取り込むと同じ状態に戻る。11/19）
  const filed = l.filed ? (l.filed.filedOn ?? '') : '未申出';
  return [LEAVE[l.kind], l.start, l.end ?? l.plannedEnd ?? '', birth ?? '', filed];
}

/** 1人分の行（列は EMPLOYEE_COLUMNS の順） */
export function employeeExportRow(x: EmployeeExportItem, deptName: (id: string) => string | null): string[] {
  const e = x.employee;
  const c = x.contract;
  const f = e.foreign;
  const acquisition = [...x.remunerations]
    .filter((r) => r.reason === 'acquisition')
    .sort((a, b) => a.from.localeCompare(b.from))[0];
  const leaves = [...(e.leaves ?? [])].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 2).reverse();
  const [l1Kind, l1Start, l1End, l1Birth, l1Filed] = leaveCells(leaves[0]);
  const [l2Kind, l2Start, l2End, l2Birth, l2Filed] = leaveCells(leaves[1]);

  const v: Record<EmployeeColumn, string> = {
    employeeNumber: e.employeeNumber ?? '',
    lastName: e.lastName,
    firstName: e.firstName,
    lastNameKana: e.lastNameKana,
    firstNameKana: e.firstNameKana,
    birthDate: e.birthDate,
    sex: e.sex ? SEX[e.sex] : '',
    postalCode: x.private?.contact.postalCode ?? '',
    address: x.private?.contact.address ?? '',
    basicPensionNumber: e.basicPensionNumber ?? '',
    insuredNumber: e.insuredNumber ?? '',
    myNumber: '', // 書き出さない
    hireDate: e.hireDate,
    retireDate: e.retireDate ?? '',
    retireReason: e.retireDate && e.retireReason ? RETIRE[e.retireReason] : '',
    retireDetail: e.retireDate ? (x.private?.register.retireDetail ?? '') : '',
    healthEnrolled: yn(e.health.enrolled),
    pensionEnrolled: yn(e.pension.enrolled),
    monthlyAmount: acquisition ? String(acquisition.monthlyAmount) : '',
    remunerationFrom: acquisition ? acquisition.from : '',
    optInDate: e.optInDate ?? '',
    optOutDate: e.optOutDate ?? '',
    employmentType: c ? EMPLOYMENT[c.employmentType] : '',
    payType: c ? PAY[c.payType] : '',
    weeklyHours: c ? hoursText(c.weeklyMinutes) : '',
    monthlyDays: c ? String(c.monthlyDays) : '',
    hourlyWage: num(c?.hourlyWage),
    dailyWage: num(c?.dailyWage),
    scheduledWage: num(c?.scheduledWage),
    expectedCash: num(c?.expectedCash),
    expectedInKind: num(c?.expectedInKind),
    periodEnd: c?.periodEnd ?? '',
    renewal: c ? RENEWAL[c.renewal] : '',
    student: c ? STUDENT[c.student] : '',
    minimumWageReduction: c ? yn(c.minimumWageReduction) : '',
    specialEmployment: c ? SPECIAL[c.specialEmployment] : '',
    renewalPrecedent: c ? yn(c.renewalPrecedent) : '',
    noExtensionAgreed: c ? yn(c.noExtensionAgreed) : '',
    nationality: f ? f.nationality : '',
    romanLastName: f?.romanLastName ?? '',
    romanFirstName: f?.romanFirstName ?? '',
    romanMiddleName: f?.romanMiddleName ?? '',
    leave1Kind: l1Kind,
    leave1Start: l1Start,
    leave1End: l1End,
    leave1Birth: l1Birth,
    leave1Filed: l1Filed,
    leave2Kind: l2Kind,
    leave2Start: l2Start,
    leave2End: l2End,
    leave2Birth: l2Birth,
    leave2Filed: l2Filed,
    department: e.org?.departmentId ? (deptName(e.org.departmentId) ?? '') : '',
    jobType: e.org?.jobType ?? '',
    history: historyText(x.private?.register.history ?? []),
    note: c?.note ?? '',
  };
  return EMPLOYEE_COLUMNS.map((k) => v[k]);
}

/** 見出し ＋ 全員分の行（並びは渡した順） */
export function employeeExportTable(items: readonly EmployeeExportItem[], deptName: (id: string) => string | null): string[][] {
  return [EMPLOYEE_COLUMNS.map((k) => EMPLOYEE_CSV_HEADERS[k]), ...items.map((x) => employeeExportRow(x, deptName))];
}
