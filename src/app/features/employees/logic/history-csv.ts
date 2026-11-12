// 履歴の取り込み（登録済みの従業員に、2回目からの雇用契約と、標準報酬月額の決定の記録を足す）
// Angular・Firebase に依存しない純粋な関数
//
// ほかのシステムから乗り換えるとき、従業員の取り込みで入るのは最初の契約と資格取得時の標準報酬だけ。
// 契約の更新と、算定・月変の記録がないと、過去の月の保険料・遡及計算・「この日の時点」の一覧が正しく出ない
//
// 決めたこと（11/12 の赤ペン）
// - ファイルは2種類（契約の履歴／標準報酬の履歴）。どちらも1行 ＝ 1件
// - 人は社員番号で見分ける（登録されていない番号はエラー。退職した人も対象）
// - 同じ日（月）の記録がもうあれば飛ばす（上書きしない。取り込みをやり直しても画面で直した値が消えない）
// - 加入（取得日・喪失日）は書き換えない（To-do の「加入の見直し」で人が確かめる）
// - 標準報酬の等級：空なら報酬月額から等級表で出す。入っていればそれを使い、出した等級と違えば注意（決定通知書が正しい）

import type { ContractInput } from '../../../core/models/contract';
import type { GradeTableDoc } from '../../../core/models/rates';
import type { RemunerationInput, RemunerationReason } from '../../../core/models/remuneration';
import { isBlankRow } from '../../../shared/csv/csv';
import { ImportField, OurTableSpec, RowValues } from '../../../shared/import/column-map';
import { toYearMonth } from '../../../shared/utils/date';
import { parseNat } from '../../../shared/utils/number';
import { toHalfWidth } from '../../../shared/utils/text';
import { gradeOf, pickGradeTable } from '../../rates/logic/grade';
import { fromContractForm } from './contract-form-model';
import {
  CONTRACT_CSV_COLUMNS,
  ContractCsvColumn,
  Dict,
  EMPLOYEE_CSV_HEADERS,
  EMPLOYEE_IMPORT_FIELDS,
  EmployeeImportKey,
  finishEmployeeRow,
  pick,
  readContractCells,
  readDate,
  readMonth,
} from './employee-csv';

export type HistoryKind = 'contract' | 'remuneration';

// ===== 列 =====

export const CONTRACT_HISTORY_HEADERS = {
  employeeNumber: '社員番号',
  from: '契約の開始日',
  ...Object.fromEntries(CONTRACT_CSV_COLUMNS.map((c) => [c, EMPLOYEE_CSV_HEADERS[c]])),
} as { employeeNumber: string; from: string } & Record<ContractCsvColumn, string>;
export type ContractHistoryColumn = 'employeeNumber' | 'from' | ContractCsvColumn;
export const CONTRACT_HISTORY_COLUMNS: readonly ContractHistoryColumn[] = [
  'employeeNumber',
  'from',
  ...CONTRACT_CSV_COLUMNS,
];
const CONTRACT_REQUIRED: readonly ContractHistoryColumn[] = [
  'employeeNumber',
  'from',
  'employmentType',
  'payType',
  'weeklyHours',
  'monthlyDays',
  'scheduledWage',
];

export const REMUNERATION_HISTORY_HEADERS = {
  employeeNumber: '社員番号',
  from: '標準報酬の開始月',
  reason: '決定の理由',
  monthlyAmount: '報酬月額',
  healthGrade: '健保の等級',
  pensionGrade: '厚年の等級',
} as const;
export type RemunerationHistoryColumn = keyof typeof REMUNERATION_HISTORY_HEADERS;
export const REMUNERATION_HISTORY_COLUMNS = Object.keys(REMUNERATION_HISTORY_HEADERS) as RemunerationHistoryColumn[];
const REMUNERATION_REQUIRED: readonly RemunerationHistoryColumn[] = ['employeeNumber', 'from', 'reason', 'monthlyAmount'];

export type HistoryColumn = ContractHistoryColumn | RemunerationHistoryColumn;

export function historyHeaders(kind: HistoryKind): Record<string, string> {
  return kind === 'contract' ? CONTRACT_HISTORY_HEADERS : REMUNERATION_HISTORY_HEADERS;
}

// 決定通知書・算定基礎届の言い方。休業終了は、産前産後休業終了時改定・育児休業等終了時改定のどちらも
const REASON: Dict<RemunerationReason> = {
  資格取得時決定: 'acquisition', 資格取得時: 'acquisition', 取得時: 'acquisition', 取得: 'acquisition', acquisition: 'acquisition',
  定時決定: 'regular', 定時: 'regular', 算定: 'regular', 算定基礎: 'regular', 算定基礎届: 'regular', regular: 'regular',
  随時改定: 'irregular', 随時: 'irregular', 月変: 'irregular', 月額変更: 'irregular', 月額変更届: 'irregular', irregular: 'irregular',
  休業終了: 'leaveEnd', 産前産後休業終了時改定: 'leaveEnd', 育児休業等終了時改定: 'leaveEnd', 産休終了: 'leaveEnd',
  育休終了: 'leaveEnd', leaveEnd: 'leaveEnd',
  その他: 'other', other: 'other',
};

// ===== 1行の読み取り =====

export interface HistoryRowError {
  column: HistoryColumn | null;
  code: string; // historyCsv.rowError.* か contract.*
}

export interface HistoryCsvRow {
  line: number;
  values: Partial<Record<HistoryColumn, string>>;
  errors: HistoryRowError[];
  parsed:
    | { kind: 'contract'; employeeNumber: string; contract: ContractInput }
    | {
        kind: 'remuneration';
        employeeNumber: string;
        from: string;
        reason: RemunerationReason;
        monthlyAmount: number;
        healthGrade: number | null;
        pensionGrade: number | null;
      }
    | null;
}

export interface HistoryCsvRead {
  missingColumns: HistoryColumn[];
  rows: HistoryCsvRow[];
}

function columnOf(kind: HistoryKind, header: string): HistoryColumn | null {
  const h = header.replace(/^﻿/, '').trim();
  const headers = historyHeaders(kind);
  for (const [c, name] of Object.entries(headers)) if (c === h || name === h) return c as HistoryColumn;
  return null;
}

function readContractRow(line: number, v: Partial<Record<HistoryColumn, string>>): HistoryCsvRow {
  const errors: HistoryRowError[] = [];
  const err = (column: HistoryColumn, code: string) => errors.push({ column, code });
  const get = (c: HistoryColumn) => (v[c] ?? '').trim();
  for (const c of CONTRACT_REQUIRED) if (!get(c)) err(c, 'required');
  const from = readDate(get('from'));
  if (from === undefined) err('from', 'date');
  const form = readContractCells(get, from, err, (c) => errors.some((e) => e.column === c));
  if (errors.length > 0) return { line, values: v, errors, parsed: null };
  return {
    line,
    values: v,
    errors,
    parsed: { kind: 'contract', employeeNumber: get('employeeNumber'), contract: fromContractForm(form)! },
  };
}

function readRemunerationRow(line: number, v: Partial<Record<HistoryColumn, string>>): HistoryCsvRow {
  const errors: HistoryRowError[] = [];
  const err = (column: HistoryColumn, code: string) => errors.push({ column, code });
  const get = (c: HistoryColumn) => (v[c] ?? '').trim();
  for (const c of REMUNERATION_REQUIRED) if (!get(c)) err(c, 'required');
  const from = readMonth(get('from'));
  if (from === undefined) err('from', 'month');
  const reason = pick(REASON, get('reason'));
  if (reason === undefined) err('reason', 'choice');
  const amount = parseNat(toHalfWidth(get('monthlyAmount')).replace(/[,円]/g, ''));
  if (amount === undefined) err('monthlyAmount', 'number');
  const grade = (c: 'healthGrade' | 'pensionGrade') => {
    const n = parseNat(toHalfWidth(get(c)).replace(/[級等]/g, ''));
    if (n === undefined || n === 0) err(c, 'number');
    return n ?? null;
  };
  const healthGrade = grade('healthGrade');
  const pensionGrade = grade('pensionGrade');
  if (errors.length > 0 || !from || !reason || amount === null || amount === undefined) {
    return { line, values: v, errors, parsed: null };
  }
  return {
    line,
    values: v,
    errors,
    parsed: {
      kind: 'remuneration',
      employeeNumber: get('employeeNumber'),
      from,
      reason,
      monthlyAmount: amount,
      healthGrade,
      pensionGrade,
    },
  };
}

/** CSV の表（1行目は見出し）を読む */
export function readHistoryCsv(kind: HistoryKind, table: string[][]): HistoryCsvRead {
  const [header = [], ...body] = table;
  const cols = header.map((h) => columnOf(kind, h));
  const required: readonly HistoryColumn[] = kind === 'contract' ? CONTRACT_REQUIRED : REMUNERATION_REQUIRED;
  const missingColumns = required.filter((c) => !cols.includes(c));
  if (missingColumns.length > 0) return { missingColumns, rows: [] };
  const rows: HistoryCsvRow[] = [];
  body.forEach((cells, i) => {
    if (isBlankRow(cells)) return;
    const v: Partial<Record<HistoryColumn, string>> = {};
    cols.forEach((c, j) => {
      if (c) v[c] = cells[j] ?? '';
    });
    rows.push(kind === 'contract' ? readContractRow(i + 2, v) : readRemunerationRow(i + 2, v));
  });
  return { missingColumns, rows };
}

// ===== 取り込みの計画 =====

export interface HistoryPerson {
  id: string;
  employeeNumber: string | null;
  lastName: string;
  firstName: string;
  hireDate: string;
  retireDate: string | null;
}

export interface HistoryContext {
  employees: readonly HistoryPerson[];
  /** 登録済みの記録の ID（従業員の ID → 契約の開始日 か 標準報酬の開始月）。ファイルに出てくる人の分だけ */
  existing: ReadonlyMap<string, ReadonlySet<string>>;
  gradeTables: readonly GradeTableDoc[];
}

export type HistoryWarning =
  | 'gradeDiffers' // 書いてある等級と、報酬月額から出した等級が違う（書いてある方を使う）
  | 'oldTable'; // その月の等級表がなく、いちばん古い表で出した

export interface HistoryItem {
  line: number;
  employeeId: string;
  employeeNumber: string;
  name: string;
  /** 記録の ID（契約の開始日・標準報酬の開始月） */
  id: string;
  contract: ContractInput | null;
  remuneration: RemunerationInput | null;
  warnings: HistoryWarning[];
  /** 出した等級（書いてある等級と違うとき、見比べるため） */
  computed?: { health: number; pension: number };
}

export type HistoryPlanErrorCode =
  | 'unknownEmployee' // 登録されていない社員番号
  | 'duplicateInFile' // 同じ人・同じ日がファイルの中に2回
  | 'beforeHire' // 入社より前
  | 'afterRetire' // 退職より後
  | 'badGrade'; // 等級表にない等級

export interface HistoryPlan {
  items: HistoryItem[];
  /** 登録済みなので飛ばした（上書きしない） */
  skipped: { line: number; employeeNumber: string; id: string }[];
  errors: { line: number; code: HistoryPlanErrorCode; employeeNumber: string; id: string }[];
}

/** その月の等級表（なければいちばん古い表） */
function tableFor(tables: readonly GradeTableDoc[], kind: 'health' | 'pension', month: string) {
  const exact = pickGradeTable([...tables], kind, month);
  if (exact) return { table: exact, old: false };
  const oldest = tables.filter((t) => t.kind === kind).sort((a, b) => a.from.localeCompare(b.from))[0] ?? null;
  return oldest ? { table: oldest, old: true } : null;
}

export function planHistoryImport(rows: readonly HistoryCsvRow[], ctx: HistoryContext): HistoryPlan {
  const plan: HistoryPlan = { items: [], skipped: [], errors: [] };
  const byNumber = new Map(ctx.employees.filter((e) => e.employeeNumber).map((e) => [e.employeeNumber!, e]));
  const seen = new Set<string>();

  for (const r of rows) {
    const p = r.parsed;
    if (!p) continue;
    const id = p.kind === 'contract' ? p.contract.from : p.from;
    const fail = (code: HistoryPlanErrorCode) =>
      plan.errors.push({ line: r.line, code, employeeNumber: p.employeeNumber, id });

    const e = byNumber.get(p.employeeNumber);
    if (!e) {
      fail('unknownEmployee');
      continue;
    }
    const key = `${e.id}/${id}`;
    if (seen.has(key)) {
      fail('duplicateInFile');
      continue;
    }
    seen.add(key);

    // 入社〜退職の間か（契約は日、標準報酬は月で比べる）
    const start = p.kind === 'contract' ? e.hireDate : toYearMonth(e.hireDate);
    const end = e.retireDate ? (p.kind === 'contract' ? e.retireDate : toYearMonth(e.retireDate)) : null;
    if (id < start) {
      fail('beforeHire');
      continue;
    }
    if (end && id > end) {
      fail('afterRetire');
      continue;
    }

    if (ctx.existing.get(e.id)?.has(id)) {
      plan.skipped.push({ line: r.line, employeeNumber: p.employeeNumber, id });
      continue;
    }

    const base = {
      line: r.line,
      employeeId: e.id,
      employeeNumber: p.employeeNumber,
      name: `${e.lastName} ${e.firstName}`.trim(),
      id,
    };
    if (p.kind === 'contract') {
      plan.items.push({ ...base, contract: p.contract, remuneration: null, warnings: [] });
      continue;
    }

    // 標準報酬：等級表で出す（書いてあればそれを使う）
    const ht = tableFor(ctx.gradeTables, 'health', p.from);
    const pt = tableFor(ctx.gradeTables, 'pension', p.from);
    if (!ht || !pt) {
      fail('badGrade');
      continue;
    }
    const warnings: HistoryWarning[] = [];
    if (ht.old || pt.old) warnings.push('oldTable');
    const calcH = gradeOf(ht.table.grades, p.monthlyAmount);
    const calcP = gradeOf(pt.table.grades, p.monthlyAmount);
    const rowOf = (t: GradeTableDoc, g: number | null) => (g === null ? null : (t.grades.find((x) => x.grade === g) ?? undefined));
    const givenH = rowOf(ht.table, p.healthGrade);
    const givenP = rowOf(pt.table, p.pensionGrade);
    if (givenH === undefined || givenP === undefined) {
      fail('badGrade');
      continue;
    }
    const health = givenH ? { grade: givenH.grade, standard: givenH.standard } : calcH;
    const pension = givenP ? { grade: givenP.grade, standard: givenP.standard } : calcP;
    if (health.grade !== calcH.grade || pension.grade !== calcP.grade) warnings.push('gradeDiffers');
    plan.items.push({
      ...base,
      contract: null,
      remuneration: { from: p.from, reason: p.reason, monthlyAmount: p.monthlyAmount, health, pension },
      warnings,
      computed: { health: calcH.grade, pension: calcP.grade },
    });
  }
  return plan;
}

/** ファイルに出てくる人（登録済みの記録を読む人だけに絞るため） */
export function employeeIdsIn(rows: readonly HistoryCsvRow[], employees: readonly HistoryPerson[]): string[] {
  const nums = new Set(rows.map((r) => r.parsed?.employeeNumber).filter((n): n is string => !!n));
  return employees.filter((e) => e.employeeNumber && nums.has(e.employeeNumber)).map((e) => e.id);
}

// ===== ひな形 =====

export function historyCsvTemplate(kind: HistoryKind): string[][] {
  if (kind === 'contract') {
    const header = CONTRACT_HISTORY_COLUMNS.map((c) => CONTRACT_HISTORY_HEADERS[c]);
    const row = (x: Partial<Record<ContractHistoryColumn, string>>) => CONTRACT_HISTORY_COLUMNS.map((c) => x[c] ?? '');
    return [
      header,
      row({
        employeeNumber: 'E002', from: '2027-04-01', employmentType: 'パート', payType: '時給',
        weeklyHours: '24:00', monthlyDays: '13', hourlyWage: '1250', scheduledWage: '130000',
        periodEnd: '2028-03-31', renewal: '更新する場合がある', student: 'いいえ',
      }),
      row({
        employeeNumber: 'E002', from: '2028-04-01', employmentType: '正社員', payType: '月給',
        weeklyHours: '40:00', monthlyDays: '21', scheduledWage: '240000', expectedCash: '255000',
      }),
    ];
  }
  const header = REMUNERATION_HISTORY_COLUMNS.map((c) => REMUNERATION_HISTORY_HEADERS[c]);
  const row = (x: Partial<Record<RemunerationHistoryColumn, string>>) =>
    REMUNERATION_HISTORY_COLUMNS.map((c) => x[c] ?? '');
  return [
    header,
    row({ employeeNumber: 'E001', from: '2026-09', reason: '定時決定', monthlyAmount: '305000' }),
    row({ employeeNumber: 'E001', from: '2027-02', reason: '随時改定', monthlyAmount: '342000', healthGrade: '24', pensionGrade: '21' }),
  ];
}

// ===== よそのファイルからの取り込み（列を合わせる画面で使う） =====

type ContractHistoryImportKey = ContractHistoryColumn | 'dailyMinutes' | 'weeklyDays';
const CONTRACT_KEYS = new Set<string>(['employeeNumber', ...CONTRACT_CSV_COLUMNS, 'dailyMinutes', 'weeklyDays']);

export const CONTRACT_HISTORY_FIELDS: readonly ImportField<ContractHistoryImportKey>[] = [
  ...EMPLOYEE_IMPORT_FIELDS.filter((f) => f.key === 'employeeNumber'),
  {
    key: 'from',
    header: CONTRACT_HISTORY_HEADERS.from,
    words: ['開始日', '契約開始日', '雇用契約開始日', '適用開始日', '有効開始日', '契約期間の始まり', '契約期間開始日', '発令日', 'start date'],
    kind: 'date',
    required: true,
  },
  ...EMPLOYEE_IMPORT_FIELDS.filter((f) => f.key !== 'employeeNumber' && CONTRACT_KEYS.has(f.key)),
].map((f) => ({ ...f, required: (CONTRACT_REQUIRED as readonly string[]).includes(f.key) })) as ImportField<ContractHistoryImportKey>[];

export const CONTRACT_HISTORY_SPEC: OurTableSpec<ContractHistoryImportKey, ContractHistoryColumn> = {
  fields: CONTRACT_HISTORY_FIELDS,
  out: CONTRACT_HISTORY_COLUMNS,
  outHeader: (c) => CONTRACT_HISTORY_HEADERS[c],
  // 1日の分 × 週の日数 → 週の時間 など（従業員の取り込みと同じ計算）
  finish: (v) => finishEmployeeRow(v as RowValues<EmployeeImportKey>) as RowValues<ContractHistoryImportKey>,
};

export const REMUNERATION_HISTORY_FIELDS: readonly ImportField<RemunerationHistoryColumn>[] = [
  {
    key: 'employeeNumber',
    header: REMUNERATION_HISTORY_HEADERS.employeeNumber,
    words: EMPLOYEE_IMPORT_FIELDS.find((f) => f.key === 'employeeNumber')?.words ?? [],
    required: true,
  },
  {
    key: 'from',
    header: REMUNERATION_HISTORY_HEADERS.from,
    words: ['開始月', '適用開始月', '改定月', '改定年月', '決定年月', '適用年月', '標準報酬月額の適用年月'],
    kind: 'month',
    required: true,
  },
  {
    key: 'reason',
    header: REMUNERATION_HISTORY_HEADERS.reason,
    words: ['決定の種類', '決定区分', '改定区分', '改定理由', '算定区分', '決定理由'],
    required: true,
  },
  {
    key: 'monthlyAmount',
    header: REMUNERATION_HISTORY_HEADERS.monthlyAmount,
    words: ['報酬月額（合計）', '報酬月額合計', '修正平均額', '平均額'],
    kind: 'number',
    required: true,
  },
  {
    key: 'healthGrade',
    header: REMUNERATION_HISTORY_HEADERS.healthGrade,
    words: ['健康保険の等級', '健康保険等級', '健保等級', '健康保険標準報酬等級'],
    kind: 'number',
  },
  {
    key: 'pensionGrade',
    header: REMUNERATION_HISTORY_HEADERS.pensionGrade,
    words: ['厚生年金保険の等級', '厚生年金等級', '厚年等級', '厚生年金標準報酬等級'],
    kind: 'number',
  },
];

export const REMUNERATION_HISTORY_SPEC: OurTableSpec<RemunerationHistoryColumn, RemunerationHistoryColumn> = {
  fields: REMUNERATION_HISTORY_FIELDS,
  out: REMUNERATION_HISTORY_COLUMNS,
  outHeader: (c) => REMUNERATION_HISTORY_HEADERS[c],
};
