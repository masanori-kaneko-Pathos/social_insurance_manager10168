// 従業員の CSV 取り込み（1行 ＝ 1人 ＝ 従業員の基本 ＋ 最初の雇用契約 ＋ 休業2件まで）
// Angular・Firebase に依存しない純粋な関数
//
// つながり（雇用条件 → 従業員登録）
// - 契約は入社日から始まる（最初の契約）
// - 加入するかは、入社日について classify した区分から決める（列で上書きできる）
// - 標準報酬は、見込みの報酬月額から資格取得時決定の等級を出す（列で報酬月額を上書きできる）
// 読み取りは画面と同じ部品（fromEmployeeForm・fromContractForm）を通す。画面で入れても CSV で入れても同じ結果になる

import type { ContractInput } from '../../../core/models/contract';
import type { Leave, LeaveKind, EmployeeFormInput, RetireReason, Sex } from '../../../core/models/employee';
import { emptyLeave } from '../../../core/models/employee';
import type { GradeTableDoc } from '../../../core/models/rates';
import type { RemunerationInput } from '../../../core/models/remuneration';
import { isBlankRow } from '../../../shared/csv/csv';
import { DATE_RE, toYearMonth, YEAR_MONTH_RE } from '../../../shared/utils/date';
import { formatHours, parseNat } from '../../../shared/utils/number';
import {
  ImportField,
  OurTableSpec,
  RowValues,
  splitName,
  ValueKind,
} from '../../../shared/import/column-map';
import { toHalfWidth } from '../../../shared/utils/text';
import { gradeOf, pickGradeTable } from '../../rates/logic/grade';
import { classify, Classification, ClassifyCriteria, ClassifyOffice, isInsured } from './classify';
import { contractErrors, emptyContractForm, fromContractForm } from './contract-form-model';
import { defaultEnrollmentDates } from './coverage';
import { emptyEmployeeForm, emptyForeignForm, fromEmployeeForm, PATTERNS } from './employee-form-model';

// ===== 列 =====

export const EMPLOYEE_CSV_HEADERS = {
  employeeNumber: '社員番号',
  lastName: '姓',
  firstName: '名',
  lastNameKana: 'セイ',
  firstNameKana: 'メイ',
  birthDate: '生年月日',
  sex: '性別',
  basicPensionNumber: '基礎年金番号',
  insuredNumber: '被保険者整理番号',
  hireDate: '入社日',
  retireDate: '退職日',
  retireReason: '退職の理由',
  healthEnrolled: '健保の加入',
  pensionEnrolled: '厚年の加入',
  monthlyAmount: '資格取得時の報酬月額',
  remunerationFrom: '標準報酬の開始月',
  optInDate: '加入の申出日',
  optOutDate: '喪失の申出日',
  employmentType: '雇用形態',
  payType: '給与の形',
  weeklyHours: '週の所定労働時間',
  monthlyDays: '月の所定労働日数',
  hourlyWage: '時給',
  dailyWage: '日給',
  scheduledWage: '所定内賃金',
  expectedCash: '見込みの報酬月額',
  expectedInKind: '見込みの報酬月額_現物',
  periodEnd: '雇用期間の終わり',
  renewal: '更新の見込み',
  student: '学生',
  minimumWageReduction: '最低賃金の減額特例',
  specialEmployment: '雇い方',
  renewalPrecedent: '更新の実績',
  noExtensionAgreed: '超えて使わない合意',
  nationality: '国籍',
  romanLastName: 'ローマ字の姓',
  romanFirstName: 'ローマ字の名',
  leave1Kind: '休業1_種類',
  leave1Start: '休業1_開始日',
  leave1End: '休業1_終了日',
  leave1Birth: '休業1_出産日・子の生年月日',
  leave2Kind: '休業2_種類',
  leave2Start: '休業2_開始日',
  leave2End: '休業2_終了日',
  leave2Birth: '休業2_出産日・子の生年月日',
  note: 'メモ',
} as const;

export type EmployeeColumn = keyof typeof EMPLOYEE_CSV_HEADERS;
export const EMPLOYEE_COLUMNS = Object.keys(EMPLOYEE_CSV_HEADERS) as EmployeeColumn[];

export const EMPLOYEE_REQUIRED: readonly EmployeeColumn[] = [
  'employeeNumber',
  'lastNameKana',
  'birthDate',
  'hireDate',
  'employmentType',
  'payType',
  'weeklyHours',
  'monthlyDays',
  'scheduledWage',
];

// ===== 値の読み方（日本語の言葉でも、コードでも読める） =====

type Dict<T extends string> = Record<string, T>;

// 1・2 は性別のコードとしてよく使われる決まり（労務ソフトの書き出しで「男女コード」として出ることがある）
const SEX: Dict<Sex> = {
  男: 'male', 男性: 'male', male: 'male', m: 'male', '1': 'male',
  女: 'female', 女性: 'female', female: 'female', f: 'female', '2': 'female',
};
const RETIRE: Dict<RetireReason> = { 退職: 'resign', resign: 'resign', 死亡: 'death', death: 'death', 転勤: 'transfer', transfer: 'transfer', その他: 'other', other: 'other' };
const EMPLOYMENT: Dict<ContractInput['employmentType']> = {
  正社員: 'regular', 正規社員: 'regular', 正規雇用: 'regular', regular: 'regular',
  契約社員: 'contract', 契約: 'contract', contract: 'contract',
  パート: 'part', 'パート・アルバイト': 'part', パートアルバイト: 'part', part: 'part',
  アルバイト: 'arbeit', arbeit: 'arbeit', 嘱託: 'shokutaku', 嘱託社員: 'shokutaku', shokutaku: 'shokutaku',
  その他: 'other', other: 'other',
};
const PAY: Dict<ContractInput['payType']> = {
  月給: 'monthly', monthly: 'monthly', 日給月給: 'dailyMonthly', dailyMonthly: 'dailyMonthly',
  日給: 'daily', daily: 'daily', 時給: 'hourly', hourly: 'hourly',
};
const RENEWAL: Dict<ContractInput['renewal']> = {
  しない: 'none', 更新しない: 'none', none: 'none',
  する場合がある: 'possible', 更新する場合がある: 'possible', possible: 'possible',
  する: 'expected', 更新する: 'expected', expected: 'expected',
};
const STUDENT: Dict<ContractInput['student']> = {
  いいえ: 'none', 学生ではない: 'none', none: 'none',
  昼間: 'daytime', 昼間の学生: 'daytime', daytime: 'daytime',
  夜間: 'other', 通信: 'other', 定時制: 'other', 休学中: 'other', '夜間・通信・定時制・休学中': 'other', other: 'other',
};
const SPECIAL: Dict<ContractInput['specialEmployment']> = {
  ふつう: 'none', none: 'none', 日雇い: 'daily', 日々雇い入れ: 'daily', daily: 'daily',
  季節的業務: 'seasonal', seasonal: 'seasonal', 臨時的事業: 'temporaryBusiness', temporaryBusiness: 'temporaryBusiness',
};
const LEAVE: Dict<LeaveKind> = {
  産休: 'maternity', 産前産後休業: 'maternity', maternity: 'maternity',
  育休: 'childcare', 育児休業: 'childcare', childcare: 'childcare',
  出生時育休: 'paternity', 産後パパ育休: 'paternity', paternity: 'paternity',
  介護休業: 'care', care: 'care', 休職: 'suspension', suspension: 'suspension',
};
// 「加入している」などは、労務ソフトの書き出しでよくある言い方（「健康保険に加入しているか」の列など）
const YES = new Set(['はい', 'あり', '○', '〇', '1', 'true', 'yes', 'y', '加入', '加入している', 'している', '対象']);
const NO = new Set(['いいえ', 'なし', '×', '0', 'false', 'no', 'n', '未加入', '加入していない', 'していない', '対象外']);

/** はい／いいえ（空は null） */
function yesNo(s: string): boolean | null | undefined {
  const t = toHalfWidth(s).trim().toLowerCase();
  if (t === '') return null;
  if (YES.has(t)) return true;
  if (NO.has(t)) return false;
  return undefined;
}

/** 日付：'2026-04-01'・'2026/4/1' を読む（空は ''、読めなければ undefined） */
export function readDate(s: string): string | undefined {
  const t = toHalfWidth(s).trim();
  if (t === '') return '';
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (!m) return undefined;
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if (!DATE_RE.test(d)) return undefined;
  // 2/30 のような日はない
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toISOString().slice(0, 10) === d ? d : undefined;
}

function readMonth(s: string): string | undefined {
  const t = toHalfWidth(s).trim();
  if (t === '') return '';
  const m = /^(\d{4})[-/.](\d{1,2})$/.exec(t);
  if (!m) return undefined;
  const v = `${m[1]}-${m[2].padStart(2, '0')}`;
  return YEAR_MONTH_RE.test(v) ? v : undefined;
}

// ===== 1行の読み取り =====

export interface CsvRowError {
  column: EmployeeColumn | null; // null は行全体
  code: string; // employeeCsv.error.* の翻訳キー
}

export interface EmployeeCsvRow {
  line: number; // ファイルの行番号（見出しが1行目）
  values: Partial<Record<EmployeeColumn, string>>;
  errors: CsvRowError[];
  /** エラーがなければ入る */
  parsed: {
    employee: EmployeeFormInput; // 加入は planImport で決める
    contract: ContractInput;
    leaves: Leave[];
    healthOverride: boolean | null;
    pensionOverride: boolean | null;
    monthlyAmount: number | null;
    remunerationFrom: string | null;
  } | null;
}

export interface EmployeeCsvRead {
  missingColumns: EmployeeColumn[];
  rows: EmployeeCsvRow[];
}

/** 見出し（日本語か列の名前）→ 列 */
function columnOf(header: string): EmployeeColumn | null {
  const h = header.replace(/^﻿/, '').trim();
  for (const c of EMPLOYEE_COLUMNS) if (c === h || EMPLOYEE_CSV_HEADERS[c] === h) return c;
  return null;
}

function pick<T extends string>(dict: Dict<T>, s: string): T | null | undefined {
  const t = s.trim();
  if (t === '') return null;
  return dict[t] ?? dict[t.toLowerCase()] ?? undefined;
}

function readLeave(
  v: Partial<Record<EmployeeColumn, string>>,
  n: 1 | 2,
  errors: CsvRowError[],
): Leave | null {
  const kindCol = `leave${n}Kind` as EmployeeColumn;
  const startCol = `leave${n}Start` as EmployeeColumn;
  const endCol = `leave${n}End` as EmployeeColumn;
  const birthCol = `leave${n}Birth` as EmployeeColumn;
  const kind = pick(LEAVE, v[kindCol] ?? '');
  if (kind === null) return null;
  if (kind === undefined) {
    errors.push({ column: kindCol, code: 'leaveKind' });
    return null;
  }
  const start = readDate(v[startCol] ?? '');
  const end = readDate(v[endCol] ?? '');
  const birth = readDate(v[birthCol] ?? '');
  if (!start) errors.push({ column: startCol, code: 'date' });
  if (end === undefined) errors.push({ column: endCol, code: 'date' });
  if (birth === undefined) errors.push({ column: birthCol, code: 'date' });
  if (!start || end === undefined || birth === undefined) return null;
  if (end && end < start) {
    errors.push({ column: endCol, code: 'endBeforeStart' });
    return null;
  }
  const l = emptyLeave(kind, start);
  l.plannedEnd = end || null;
  if (kind === 'maternity') {
    l.expectedBirthDate = birth || null;
    l.birthDate = birth || null;
  }
  if (kind === 'childcare' || kind === 'paternity') {
    l.childBirthDate = birth || null;
    l.childType = 'natural';
  }
  return l;
}

function readRow(line: number, v: Partial<Record<EmployeeColumn, string>>): EmployeeCsvRow {
  const errors: CsvRowError[] = [];
  const err = (column: EmployeeColumn, code: string) => errors.push({ column, code });
  const get = (c: EmployeeColumn) => (v[c] ?? '').trim();

  for (const c of EMPLOYEE_REQUIRED) if (!get(c)) err(c, 'required');

  // --- 従業員 ---
  const birthDate = readDate(get('birthDate'));
  const hireDate = readDate(get('hireDate'));
  const retireDate = readDate(get('retireDate'));
  const optInDate = readDate(get('optInDate'));
  const optOutDate = readDate(get('optOutDate'));
  const dates: [EmployeeColumn, string | undefined][] = [
    ['birthDate', birthDate],
    ['hireDate', hireDate],
    ['retireDate', retireDate],
    ['optInDate', optInDate],
    ['optOutDate', optOutDate],
  ];
  for (const [c, d] of dates) if (d === undefined) err(c, 'date');
  if (hireDate && retireDate && retireDate < hireDate) err('retireDate', 'retireBeforeHire');
  if (birthDate && hireDate && hireDate <= birthDate) err('hireDate', 'hireBeforeBirth');

  const sex = pick(SEX, get('sex'));
  if (sex === undefined) err('sex', 'choice');
  const retireReason = pick(RETIRE, get('retireReason'));
  if (retireReason === undefined) err('retireReason', 'choice');

  const kanaOk = (s: string) => s === '' || PATTERNS.kana.test(s);
  if (!kanaOk(get('lastNameKana'))) err('lastNameKana', 'kana');
  if (!kanaOk(get('firstNameKana'))) err('firstNameKana', 'kana');

  const nationality = toHalfWidth(get('nationality')).toUpperCase();
  const foreign = nationality !== '' && nationality !== 'JP';
  if (nationality && !PATTERNS.country.test(nationality)) err('nationality', 'country');
  if (!foreign && !get('lastName')) err('lastName', 'required');
  const romanOk = (s: string) => s === '' || PATTERNS.roman.test(toHalfWidth(s));
  if (!romanOk(get('romanLastName'))) err('romanLastName', 'roman');
  if (!romanOk(get('romanFirstName'))) err('romanFirstName', 'roman');

  if (get('basicPensionNumber') && !PATTERNS.basicPensionNumber.test(toHalfWidth(get('basicPensionNumber')))) {
    err('basicPensionNumber', 'pensionNumber');
  }

  const healthOverride = yesNo(get('healthEnrolled'));
  const pensionOverride = yesNo(get('pensionEnrolled'));
  if (healthOverride === undefined) err('healthEnrolled', 'yesNo');
  if (pensionOverride === undefined) err('pensionEnrolled', 'yesNo');
  const monthlyAmount = parseNat(get('monthlyAmount'));
  if (monthlyAmount === undefined) err('monthlyAmount', 'number');
  const remunerationFrom = readMonth(get('remunerationFrom'));
  if (remunerationFrom === undefined) err('remunerationFrom', 'month');

  // --- 契約（画面と同じ部品でチェックする） ---
  const employmentType = pick(EMPLOYMENT, get('employmentType'));
  const payType = pick(PAY, get('payType'));
  const renewal = pick(RENEWAL, get('renewal'));
  const student = pick(STUDENT, get('student'));
  const special = pick(SPECIAL, get('specialEmployment'));
  const choices: [EmployeeColumn, unknown][] = [
    ['employmentType', employmentType],
    ['payType', payType],
    ['renewal', renewal],
    ['student', student],
    ['specialEmployment', special],
  ];
  for (const [c, x] of choices) if (x === undefined && get(c)) err(c, 'choice');
  const reduction = yesNo(get('minimumWageReduction'));
  const precedent = yesNo(get('renewalPrecedent'));
  const agreed = yesNo(get('noExtensionAgreed'));
  const flags: [EmployeeColumn, boolean | null | undefined][] = [
    ['minimumWageReduction', reduction],
    ['renewalPrecedent', precedent],
    ['noExtensionAgreed', agreed],
  ];
  for (const [c, x] of flags) if (x === undefined) err(c, 'yesNo');
  const periodEnd = readDate(get('periodEnd'));
  if (periodEnd === undefined) err('periodEnd', 'date');

  const contractForm = {
    ...emptyContractForm(hireDate || ''),
    employmentType: employmentType ?? 'regular',
    payType: payType ?? 'monthly',
    hours: get('weeklyHours'),
    monthlyDays: get('monthlyDays'),
    hourlyWage: get('hourlyWage'),
    dailyWage: get('dailyWage'),
    scheduledWage: get('scheduledWage'),
    // 見込みの報酬月額は、空なら所定内賃金を写す（画面と同じ）
    expectedCash: get('expectedCash') || get('scheduledWage'),
    expectedInKind: get('expectedInKind') || '0',
    periodEnd: periodEnd || '',
    renewal: renewal ?? 'none',
    student: student ?? 'none',
    minimumWageReduction: reduction ?? false,
    specialEmployment: special ?? 'none',
    renewalPrecedent: precedent ?? false,
    noExtensionAgreed: agreed ?? false,
    note: get('note'),
  };
  // 契約のエラーは、CSV の列に置き換えて出す
  const CONTRACT_COLUMN: Record<string, EmployeeColumn> = {
    hours: 'weeklyHours',
    monthlyDays: 'monthlyDays',
    hourlyWage: 'hourlyWage',
    dailyWage: 'dailyWage',
    scheduledWage: 'scheduledWage',
    expectedCash: 'expectedCash',
    expectedInKind: 'expectedInKind',
    periodEnd: 'periodEnd',
  };
  // 雇用形態は契約のチェックに関係しないので、給与の形と入社日が読めれば確かめる
  if (hireDate && payType) {
    for (const [field, code] of Object.entries(contractErrors(contractForm))) {
      const column = CONTRACT_COLUMN[field];
      if (column && !errors.some((e) => e.column === column)) err(column, `contract.${code}`);
    }
  }

  const leaves = [readLeave(v, 1, errors), readLeave(v, 2, errors)].filter((l): l is Leave => !!l);

  if (errors.length > 0) return { line, values: v, errors, parsed: null };

  // --- 画面と同じ部品で、保存する形にする ---
  const form = emptyEmployeeForm();
  form.employeeNumber = get('employeeNumber');
  form.lastName = get('lastName');
  form.firstName = get('firstName');
  form.lastNameKana = get('lastNameKana');
  form.firstNameKana = get('firstNameKana');
  form.birthDate = birthDate!;
  form.sex = sex ?? '';
  form.basicPensionNumber = get('basicPensionNumber');
  form.insuredNumber = get('insuredNumber');
  form.hireDate = hireDate!;
  form.retireDate = retireDate ?? '';
  form.retireReason = retireDate ? (retireReason ?? 'resign') : '';
  form.optInDate = optInDate ?? '';
  form.optOutDate = optOutDate ?? '';
  if (foreign) {
    form.hasForeign = true;
    form.foreign = {
      ...emptyForeignForm(),
      nationality,
      romanLastName: get('romanLastName'),
      romanFirstName: get('romanFirstName'),
      // ローマ字がない外国籍の人（漢字の国など）は、姓・名を漢字氏名として使う
      ...(get('romanLastName')
        ? {}
        : {
            noRomanReason: 'notOnCard' as const,
            kanjiName: {
              last: get('lastName'),
              first: get('firstName'),
              lastKana: get('lastNameKana'),
              firstKana: get('firstNameKana'),
            },
            filingName: 'kanji' as const,
          }),
    };
  }
  const employee = fromEmployeeForm(form);
  const contract = fromContractForm(contractForm)!;

  return {
    line,
    values: v,
    errors,
    parsed: {
      employee,
      contract,
      leaves,
      healthOverride: healthOverride ?? null,
      pensionOverride: pensionOverride ?? null,
      monthlyAmount: monthlyAmount ?? null,
      remunerationFrom: remunerationFrom || null,
    },
  };
}

/** CSV の表（parseCsv の結果）を読む。1行目は見出し */
export function readEmployeeCsv(table: string[][]): EmployeeCsvRead {
  const [header = [], ...body] = table;
  const cols = header.map(columnOf);
  const missingColumns = EMPLOYEE_REQUIRED.filter((c) => !cols.includes(c));
  if (missingColumns.length > 0) return { missingColumns, rows: [] };
  const rows: EmployeeCsvRow[] = [];
  body.forEach((cells, i) => {
    if (isBlankRow(cells)) return;
    const v: Partial<Record<EmployeeColumn, string>> = {};
    cols.forEach((c, j) => {
      if (c) v[c] = cells[j] ?? '';
    });
    rows.push(readRow(i + 2, v));
  });
  return { missingColumns, rows };
}

// ===== 取り込みの計画（加入・標準報酬を契約から出す） =====

export interface ImportContext {
  office: ClassifyOffice;
  criteria: ClassifyCriteria[];
  gradeTables: GradeTableDoc[];
  /** 登録済みの社員番号 */
  existingNumbers: ReadonlySet<string>;
}

export type ImportWarning =
  | 'notInsured' // 区分の判定で加入しない（理由は classification）
  | 'unknownCategory' // 判定できない（所定が空など）→ 加入しないで登録する
  | 'override' // 加入を列で上書きした
  | 'oldTable'; // 標準報酬の開始月に等級表がなく、いちばん古い表で出した

export interface ImportItem {
  line: number;
  employee: EmployeeFormInput;
  contract: ContractInput;
  leaves: Leave[];
  remuneration: RemunerationInput | null;
  classification: Classification;
  warnings: ImportWarning[];
}

export interface ImportPlan {
  items: ImportItem[];
  /** 社員番号の重複（ファイルの中・登録済み）。取り込まない */
  errors: { line: number; code: 'duplicateInFile' | 'alreadyExists'; employeeNumber: string }[];
}

export function planImport(rows: EmployeeCsvRow[], ctx: ImportContext): ImportPlan {
  const items: ImportItem[] = [];
  const errors: ImportPlan['errors'] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    if (!r.parsed) continue;
    const p = r.parsed;
    const num = p.employee.employeeNumber ?? '';
    if (ctx.existingNumbers.has(num)) {
      errors.push({ line: r.line, code: 'alreadyExists', employeeNumber: num });
      continue;
    }
    if (seen.has(num)) {
      errors.push({ line: r.line, code: 'duplicateInFile', employeeNumber: num });
      continue;
    }
    seen.add(num);

    const e = p.employee;
    const classification = classify(
      { birthDate: e.birthDate, optInDate: e.optInDate, optOutDate: e.optOutDate, contracts: [p.contract] },
      ctx.office,
      ctx.criteria,
      e.hireDate,
    );
    const warnings: ImportWarning[] = [];
    const auto = isInsured(classification);
    if (classification.category === 'unknown') warnings.push('unknownCategory');
    else if (!auto) warnings.push('notInsured');

    const health = p.healthOverride ?? auto;
    const pension = p.pensionOverride ?? auto;
    if ((p.healthOverride !== null && p.healthOverride !== auto) || (p.pensionOverride !== null && p.pensionOverride !== auto)) {
      warnings.push('override');
    }
    const dates = defaultEnrollmentDates(e.hireDate, e.retireDate);
    const enrollment = (on: boolean) => ({
      enrolled: on,
      acquiredDate: on ? dates.acquiredDate : null,
      lostDate: on ? dates.lostDate : null,
      lossReason: on && dates.lostDate ? ('retire' as const) : null,
    });
    const employee: EmployeeFormInput = { ...e, health: enrollment(health), pension: enrollment(pension) };

    // 標準報酬（資格取得時決定）：加入する人だけ
    let remuneration: RemunerationInput | null = null;
    if (health || pension) {
      const from = p.remunerationFrom ?? toYearMonth(e.hireDate);
      const amount = p.monthlyAmount ?? p.contract.expectedCash + p.contract.expectedInKind;
      const oldest = (kind: 'health' | 'pension') =>
        ctx.gradeTables.filter((t) => t.kind === kind).sort((a, b) => a.from.localeCompare(b.from))[0] ?? null;
      const table = (kind: 'health' | 'pension') => pickGradeTable(ctx.gradeTables, kind, from) ?? oldest(kind);
      const ht = table('health');
      const pt = table('pension');
      if (ht && pt) {
        if (!pickGradeTable(ctx.gradeTables, 'health', from)) warnings.push('oldTable');
        remuneration = {
          from,
          reason: 'acquisition',
          monthlyAmount: amount,
          health: gradeOf(ht.grades, amount),
          pension: gradeOf(pt.grades, amount),
        };
      }
    }

    items.push({
      line: r.line,
      employee,
      contract: p.contract,
      leaves: p.leaves,
      remuneration,
      classification,
      warnings,
    });
  }
  return { items, errors };
}

// ===== ひな形 =====

/** ひな形の CSV（見出し ＋ 例2行） */
export function employeeCsvTemplate(): string[][] {
  const header = EMPLOYEE_COLUMNS.map((c) => EMPLOYEE_CSV_HEADERS[c]);
  const row = (x: Partial<Record<EmployeeColumn, string>>) => EMPLOYEE_COLUMNS.map((c) => x[c] ?? '');
  return [
    header,
    row({
      employeeNumber: 'E001', lastName: '山田', firstName: '太郎', lastNameKana: 'ヤマダ', firstNameKana: 'タロウ',
      birthDate: '1990-05-15', sex: '男', hireDate: '2026-04-01', employmentType: '正社員', payType: '月給',
      weeklyHours: '40:00', monthlyDays: '21', scheduledWage: '280000', expectedCash: '300000',
    }),
    row({
      employeeNumber: 'E002', lastName: '佐藤', firstName: '花子', lastNameKana: 'サトウ', firstNameKana: 'ハナコ',
      birthDate: '1995-08-01', sex: '女', hireDate: '2026-10-01', employmentType: 'パート', payType: '時給',
      weeklyHours: '20:00', monthlyDays: '12', hourlyWage: '1200', scheduledWage: '104000', student: 'いいえ',
    }),
  ];
}

// ===== よそのファイルからの取り込み（列を合わせる画面で使う） =====
// 言い換えの表は、労務ソフト・給与ソフトの書き出しによくある見出しを入れてある（11/11 に各社のヘルプで調べた）

/** うちの列に加えて、計算に使うだけの項目（うちの表には出さない） */
export type EmployeeImportKey = EmployeeColumn | 'fullName' | 'fullNameKana' | 'dailyMinutes' | 'weeklyDays';

const W: Partial<Record<EmployeeImportKey, readonly string[]>> = {
  employeeNumber: ['従業員番号', '従業員コード', '社員コード', '社員No', '社員ID', '職員番号', 'employee number', 'employee id', 'employee code'],
  lastName: ['氏', '苗字', 'last name', 'family name', 'surname'],
  firstName: ['first name', 'given name'],
  lastNameKana: ['姓カナ', '姓フリガナ', '姓ヨミガナ', '姓（ヨミガナ）', 'セイカナ', 'フリガナ姓', 'カナ姓', '氏フリガナ'],
  firstNameKana: ['名カナ', '名フリガナ', '名ヨミガナ', '名（ヨミガナ）', 'メイカナ', 'フリガナ名', 'カナ名'],
  fullName: ['氏名', '姓名', '名前', '姓＋名', '社員名', '従業員名', 'name', 'full name'],
  fullNameKana: ['フリガナ', '氏名カナ', '氏名フリガナ', 'ヨミガナ', 'カナ氏名', '姓＋名（ヨミガナ）'],
  birthDate: ['誕生日', 'date of birth', 'birth date', 'birthday'],
  sex: ['男女', '男女コード', '男女区分', '戸籍上の性別', '性別コード', 'gender', 'sex'],
  basicPensionNumber: ['basic pension number'],
  insuredNumber: ['健康保険の被保険者整理番号', '健康保険被保険者整理番号', '厚生年金保険の被保険者整理番号'],
  hireDate: ['入社年月日', '雇用開始日', '採用日', '入社年月', 'hire date'],
  retireDate: ['退職年月日', '退社日', '離職日', '退職年月'],
  retireReason: ['退職理由', '退職事由'],
  healthEnrolled: ['健康保険に加入しているか', '健康保険の加入', '健康保険加入', '健保加入'],
  pensionEnrolled: ['厚生年金保険に加入しているか', '厚生年金保険の加入', '厚生年金加入', '厚年加入'],
  monthlyAmount: ['報酬月額', '標準報酬月額', '健康保険標準報酬月額', '健康保険の標準報酬月額'],
  employmentType: ['雇用区分', '社員区分', 'employment type'],
  payType: ['給与方式', '給与支給形態', '給与形態', '賃金形態', '支給形態', 'pay type'],
  weeklyHours: ['週所定労働時間', '週の労働時間', '所定労働時間（週）'],
  monthlyDays: ['月所定労働日数', '一ヶ月の平均所定労働日数', '1か月の平均所定労働日数', '月平均所定労働日数', '月の労働日数'],
  dailyMinutes: ['日の契約労働時間', '1日の所定労働時間（分）', '1日の所定労働時間分'],
  weeklyDays: ['週の契約労働日数', '週所定労働日数', '週の労働日数'],
  hourlyWage: ['時間給', '基本時給'],
  dailyWage: ['日額'],
  periodEnd: ['契約終了日', '雇用期間終了日', '契約満了日', '契約期間の終わり'],
  renewal: ['契約更新の有無', '更新の有無'],
  nationality: ['国籍・地域', 'nationality'],
  note: ['備考'],
};

const KIND: Partial<Record<EmployeeImportKey, ValueKind>> = {
  lastNameKana: 'kana', firstNameKana: 'kana', fullNameKana: 'kana',
  birthDate: 'date', hireDate: 'date', retireDate: 'date', optInDate: 'date', optOutDate: 'date', periodEnd: 'date',
  leave1Start: 'date', leave1End: 'date', leave1Birth: 'date', leave2Start: 'date', leave2End: 'date', leave2Birth: 'date',
  remunerationFrom: 'month',
  basicPensionNumber: 'digits', insuredNumber: 'digits',
  monthlyAmount: 'number', hourlyWage: 'number', dailyWage: 'number', scheduledWage: 'number',
  expectedCash: 'number', expectedInKind: 'number', dailyMinutes: 'number',
  monthlyDays: 'days', weeklyDays: 'number',
};

/** 計算に使うだけの項目の見出し（画面に出す） */
export const EMPLOYEE_EXTRA_HEADERS: Record<Exclude<EmployeeImportKey, EmployeeColumn>, string> = {
  fullName: '氏名（姓と名が1つの列）',
  fullNameKana: 'フリガナ（セイとメイが1つの列）',
  dailyMinutes: '1日の所定労働時間（分）',
  weeklyDays: '週の所定労働日数',
};

const ORDER: readonly EmployeeImportKey[] = [
  ...EMPLOYEE_COLUMNS.slice(0, 5), 'fullName', 'fullNameKana',
  ...EMPLOYEE_COLUMNS.slice(5).flatMap((c): EmployeeImportKey[] =>
    c === 'monthlyDays' ? [c, 'dailyMinutes', 'weeklyDays'] : [c]),
];

const OR_FROM: Partial<Record<EmployeeColumn, readonly EmployeeImportKey[]>> = {
  lastNameKana: ['fullNameKana'],
  weeklyHours: ['dailyMinutes', 'weeklyDays'],
  monthlyDays: ['weeklyDays'],
};

export const EMPLOYEE_IMPORT_FIELDS: readonly ImportField<EmployeeImportKey>[] = ORDER.map((key) => ({
  key,
  header: key in EMPLOYEE_CSV_HEADERS
    ? EMPLOYEE_CSV_HEADERS[key as EmployeeColumn]
    : EMPLOYEE_EXTRA_HEADERS[key as Exclude<EmployeeImportKey, EmployeeColumn>],
  words: W[key] ?? [],
  kind: KIND[key],
  required: (EMPLOYEE_REQUIRED as readonly string[]).includes(key),
  orFrom: OR_FROM[key as EmployeeColumn],
}));

/**
 * 項目どうしの計算（空の項目だけを埋める）
 * - 氏名・フリガナが1列 → 空白で姓と名に分ける
 * - 1日の分 × 週の日数 → 週の所定労働時間
 * - 週の日数 × 52 ÷ 12（切り捨て）→ 月の所定労働日数（会社の休日の決め方で変わるので、画面で注意を出す）
 */
export function finishEmployeeRow(v: RowValues<EmployeeImportKey>): RowValues<EmployeeImportKey> {
  const out = { ...v };
  if (!out.lastName && !out.firstName && out.fullName) [out.lastName, out.firstName] = splitName(out.fullName);
  if (!out.lastNameKana && !out.firstNameKana && out.fullNameKana) {
    [out.lastNameKana, out.firstNameKana] = splitName(out.fullNameKana);
  }
  const num = (s: string | undefined) => (s && /^\d+(\.\d+)?$/.test(s) ? Number(s) : null);
  const daily = num(out.dailyMinutes);
  const week = num(out.weeklyDays);
  if (!out.weeklyHours && daily !== null && week !== null) out.weeklyHours = formatHours(Math.round(daily * week));
  if (!out.monthlyDays && week !== null) out.monthlyDays = String(Math.floor((week * 52) / 12));
  return out;
}

export const EMPLOYEE_TABLE_SPEC: OurTableSpec<EmployeeImportKey, EmployeeColumn> = {
  fields: EMPLOYEE_IMPORT_FIELDS,
  out: EMPLOYEE_COLUMNS,
  outHeader: (c) => EMPLOYEE_CSV_HEADERS[c],
  finish: finishEmployeeRow,
};
