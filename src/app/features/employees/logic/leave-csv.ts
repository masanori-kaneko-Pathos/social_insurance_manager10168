// 休業の履歴の取り込み（11/27）：1行に1件の休業。従業員のファイルの休業の列は2件までなので、3件目からはこちらで足す
// 読み方は従業員のファイルの休業の列と同じ（readLeave）。登録済みと同じ休業（種類・開始日が同じ）は飛ばす
// Angular・Firebase に依存しない純粋な関数

import type { Leave } from '../../../core/models/employee';
import { isBlankRow } from '../../../shared/csv/csv';
import { CsvRowError, dateErrorCode, EMPLOYEE_CSV_HEADERS, EmployeeColumn, readDate, readLeave } from './employee-csv';
import { makeNumberMatcher } from '../../../shared/import/number-match';

export const LEAVE_CSV_HEADERS = {
  employeeNumber: '社員番号',
  kind: '休業の種類',
  start: '開始日',
  end: '終了日',
  birth: '出産日・子の生年月日',
  filed: '申出日',
  /** 産休の出産予定日（任意。出産日と違えば「産前産後休業取得者変更届」の To-do が出る。11/28） */
  expected: '出産予定日',
} as const;
export type LeaveColumn = keyof typeof LEAVE_CSV_HEADERS;
export const LEAVE_COLUMNS = Object.keys(LEAVE_CSV_HEADERS) as LeaveColumn[];

/** 従業員のファイルの休業1の列と同じ並び（読み方を共有するため） */
const AS_EMPLOYEE: Record<Exclude<LeaveColumn, 'employeeNumber' | 'expected'>, EmployeeColumn> = {
  kind: 'leave1Kind',
  start: 'leave1Start',
  end: 'leave1End',
  birth: 'leave1Birth',
  filed: 'leave1Filed',
};

/** 見出しの言い方（従業員のファイルの「休業1_種類」なども読む） */
const WORDS: Record<LeaveColumn, readonly string[]> = {
  employeeNumber: ['社員番号', '従業員番号', '社員コード'],
  kind: ['休業の種類', '種類', EMPLOYEE_CSV_HEADERS.leave1Kind],
  start: ['開始日', '休業開始日', EMPLOYEE_CSV_HEADERS.leave1Start],
  end: ['終了日', '終了予定日', '休業終了日', EMPLOYEE_CSV_HEADERS.leave1End],
  birth: ['出産日・子の生年月日', '出産日', '子の生年月日', EMPLOYEE_CSV_HEADERS.leave1Birth],
  expected: ['出産予定日', '休業1_出産予定日'],
  filed: ['申出日', '申出書の提出日', EMPLOYEE_CSV_HEADERS.leave1Filed],
};

export function leaveLabels(column: string): string[] {
  return [...(WORDS[column as LeaveColumn] ?? [column])];
}

export interface LeaveTarget {
  id: string;
  employeeNumber: string | null;
  lastName: string;
  firstName: string;
  hireDate: string;
  retireDate: string | null;
  leaves: readonly Leave[];
}

export interface LeaveRowError {
  column: LeaveColumn | null;
  code: string; // employeeCsv.rowError.* か leaveCsv.error.*
}

export interface LeaveImportRow {
  line: number;
  employee: LeaveTarget | null;
  leave: Leave | null;
  errors: LeaveRowError[];
  /** 登録済みと同じ休業（飛ばす） */
  skip: boolean;
  /** 社員番号の先頭の0を補って照合した（11/28） */
  zeroPadded: boolean;
}

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

export function planLeaveImport(table: readonly (readonly string[])[], targets: readonly LeaveTarget[]): { rows: LeaveImportRow[]; missing: LeaveColumn[] } {
  if (table.length === 0) return { rows: [], missing: ['employeeNumber', 'kind', 'start'] };
  const header = table[0].map((h) => norm(h ?? ''));
  const index = {} as Partial<Record<LeaveColumn, number>>;
  for (const c of LEAVE_COLUMNS) {
    const i = header.findIndex((h) => WORDS[c].some((w) => norm(w) === h));
    if (i >= 0) index[c] = i;
  }
  const missing = (['employeeNumber', 'kind', 'start'] as LeaveColumn[]).filter((c) => index[c] === undefined);
  if (missing.length > 0) return { rows: [], missing };
  const matchNo = makeNumberMatcher(targets, (t) => t.employeeNumber);
  const seen = new Set<string>();
  const rows: LeaveImportRow[] = [];
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    if (isBlankRow(r)) return;
    const get = (c: LeaveColumn) => (index[c] === undefined ? '' : (r[index[c]!] ?? ''));
    const errors: LeaveRowError[] = [];
    const m = matchNo(get('employeeNumber'));
    const employee = m.kind === 'ok' ? m.item : null;
    if (m.kind === 'none') errors.push({ column: 'employeeNumber', code: 'leaveCsv.error.unknownEmployee' });
    else if (m.kind === 'ambiguous') errors.push({ column: 'employeeNumber', code: 'leaveCsv.error.ambiguousEmployee' });
    // 従業員のファイルの休業1の列として読む（読み方・エラーを共有）
    const v: Partial<Record<EmployeeColumn, string>> = {};
    for (const [c, ec] of Object.entries(AS_EMPLOYEE)) v[ec] = get(c as LeaveColumn);
    const raw: CsvRowError[] = [];
    if (get('kind').trim() === '') errors.push({ column: 'kind', code: 'employeeCsv.rowError.required' });
    const leave = get('kind').trim() === '' ? null : readLeave(v, 1, raw);
    for (const e of raw) {
      const col = (Object.entries(AS_EMPLOYEE).find(([, ec]) => ec === e.column)?.[0] ?? null) as LeaveColumn | null;
      errors.push({ column: col, code: `employeeCsv.rowError.${e.code}` });
    }
    // 出産予定日（任意）：産休だけ。出産日がないときは、予定日として入れる
    const expectedRaw = get('expected').trim();
    if (expectedRaw && leave) {
      const exp = readDate(expectedRaw);
      if (exp === undefined) errors.push({ column: 'expected', code: `employeeCsv.rowError.${dateErrorCode(expectedRaw)}` });
      else if (leave.kind === 'maternity') leave.expectedBirthDate = exp;
    }
    let skip = false;
    if (employee && leave) {
      const key = `${employee.id}|${leave.kind}|${leave.start}`;
      if (seen.has(key)) errors.push({ column: 'start', code: 'leaveCsv.error.duplicateInFile' });
      seen.add(key);
      if (leave.start < employee.hireDate || (employee.retireDate && leave.start > employee.retireDate)) {
        errors.push({ column: 'start', code: 'leaveCsv.error.notEmployed' });
      }
      skip = employee.leaves.some((l) => l.kind === leave.kind && l.start === leave.start);
    }
    rows.push({ line, employee, leave: errors.length === 0 ? leave : null, errors, skip, zeroPadded: m.kind === 'ok' && m.zeroPadded });
  });
  return { rows, missing: [] };
}

export function leaveCsvTemplate(): string[][] {
  return [
    LEAVE_COLUMNS.map((c) => LEAVE_CSV_HEADERS[c]),
    ['E007', '産休', '2026-06-01', '2026-09-07', '2026-07-13', '2026-05-20', '2026-07-13'],
    ['E007', '育休', '2026-09-08', '2027-07-12', '2026-07-13', '2026-08-20', ''],
    ['E007', '育休', '2027-09-01', '2027-09-14', '2026-07-13', '2027-08-20', ''],
    ['E003', '出生時育休', '2026-10-01', '2026-10-14', '2026-09-28', '2026-09-20', ''],
    ['E003', '休職', '2027-01-10', '2027-03-31', '', '', ''],
  ];
}
