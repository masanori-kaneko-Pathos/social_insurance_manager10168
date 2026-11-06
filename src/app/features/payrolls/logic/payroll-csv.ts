// 給与の実績の CSV（取り込み・書き出し。往復できる同じ形）
// 1行 ＝ 1人 × 1か月。列は見出しの名前で読む（並び順は自由。日本語・英語どちらの見出しでもよい）

import { Payroll, PayrollInput, PayrollState } from '../../../core/models/payroll';
import { isBlankRow } from '../../../shared/csv/csv';
import { formatHours, PayrollRowText, readRow, RowError, sameInput } from './payroll-input';
import { addMonths, daysBetween, employedDuring, PayrollEmployee, PaySchedule, periodOf } from './payroll-rows';

// ===== 列 =====

export type PayrollColumn =
  | 'employeeNumber'
  | 'name'
  | 'paidMonth'
  | 'cash'
  | 'fixed'
  | 'days'
  | 'inKind'
  | 'retro'
  | 'absentDays'
  | 'hours'
  | 'prorated'
  | 'state';

/** 書き出す順番 */
export const PAYROLL_COLUMNS: readonly PayrollColumn[] = [
  'employeeNumber',
  'name',
  'paidMonth',
  'cash',
  'fixed',
  'days',
  'inKind',
  'retro',
  'absentDays',
  'hours',
  'prorated',
  'state',
];

const REQUIRED: readonly PayrollColumn[] = ['employeeNumber', 'paidMonth', 'cash', 'fixed', 'days'];

export type CsvLang = 'ja' | 'en';

export const PAYROLL_HEADERS: Record<CsvLang, Record<PayrollColumn, string>> = {
  ja: {
    employeeNumber: '社員番号',
    name: '氏名',
    paidMonth: '支払った月',
    cash: '通貨の額',
    fixed: '固定的賃金',
    days: '支払基礎日数',
    inKind: '現物',
    retro: '遡及支払額',
    absentDays: '欠勤日数',
    hours: '実労働時間',
    prorated: '日割り',
    state: '状態',
  },
  en: {
    employeeNumber: 'Employee number',
    name: 'Name',
    paidMonth: 'Month paid',
    cash: 'Cash pay',
    fixed: 'Fixed wages',
    days: 'Payment basis days',
    inKind: 'In kind',
    retro: 'Retroactive pay',
    absentDays: 'Days absent',
    hours: 'Hours worked',
    prorated: 'Prorated',
    state: 'Status',
  },
};

const STATE_LABELS: Record<CsvLang, Record<PayrollState, string>> = {
  ja: { normal: '通常', suspended: '休職', furlough: '一時帰休' },
  en: { normal: 'Normal', suspended: 'Leave of absence', furlough: 'Temporary layoff' },
};

const norm = (s: string) =>
  s
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/[／－ー‐]/g, (c) => (c === '／' ? '/' : '-'))
    .trim();

const headerKey = (s: string) => norm(s).toLowerCase().replace(/\s+/g, '');

/** 見出しの行 → 列の位置。知らない列は無視する */
export function mapHeader(header: readonly string[]): {
  index: Partial<Record<PayrollColumn, number>>;
  missing: PayrollColumn[];
} {
  const lookup = new Map<string, PayrollColumn>();
  for (const lang of ['ja', 'en'] as const) {
    for (const col of PAYROLL_COLUMNS) lookup.set(headerKey(PAYROLL_HEADERS[lang][col]), col);
  }
  const index: Partial<Record<PayrollColumn, number>> = {};
  header.forEach((h, i) => {
    const col = lookup.get(headerKey(h));
    if (col && index[col] === undefined) index[col] = i;
  });
  return { index, missing: REQUIRED.filter((c) => index[c] === undefined) };
}

// ===== 値の読み分け（Excel で変わってしまう形も読む） =====

/**
 * 支払った月を 'YYYY-MM' にする
 * '2026-10'・'2026/10'・'2026/10/1'（Excel が日付にしたもの）・'2026-10-01'・'2026年10月'・'202610'
 */
export function parseMonth(s: string): string | null {
  const t = norm(s);
  let m = /^(\d{4})[-/.年](\d{1,2})月?(?:[-/.](\d{1,2})日?)?$/.exec(t);
  if (!m) m = /^(\d{4})(\d{2})$/.exec(t);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${String(month).padStart(2, '0')}`;
}

/** 日割り：空欄・0・いいえ → false、1・○・はい → true、それ以外は読めない */
export function parseFlag(s: string): boolean | undefined {
  const t = norm(s).toLowerCase();
  if (['', '0', '×', '✕', 'x', 'いいえ', 'なし', 'false', 'no', 'n'].includes(t)) return false;
  if (['1', '○', '〇', '◯', 'はい', 'あり', 'true', 'yes', 'y'].includes(t)) return true;
  return undefined;
}

/** 状態：空欄は通常 */
export function parseState(s: string): PayrollState | undefined {
  const t = norm(s).toLowerCase();
  if (t === '') return 'normal';
  for (const lang of ['ja', 'en'] as const) {
    for (const [k, label] of Object.entries(STATE_LABELS[lang])) {
      if (t === label.toLowerCase() || t === k) return k as PayrollState;
    }
  }
  return undefined;
}

// ===== 人の照合 =====

export interface CsvEmployee extends PayrollEmployee {
  employeeNumber: string | null;
  lastName: string;
  firstName: string;
}

type Match =
  | { kind: 'ok'; employee: CsvEmployee; zeroPadded: boolean }
  | { kind: 'none' }
  | { kind: 'ambiguous' };

const stripZeros = (s: string) => s.replace(/^0+(?=\d)/, '');

/**
 * 社員番号で照合する。そのままで見つからないときは、先頭の0を落とした形で照合する
 * （Excel で開くと「0012」が「12」になるため）。どちらも、2人以上あたれば ambiguous
 */
export function makeMatcher(employees: readonly CsvEmployee[]): (no: string) => Match {
  const exact = new Map<string, CsvEmployee[]>();
  const loose = new Map<string, CsvEmployee[]>();
  for (const e of employees) {
    if (!e.employeeNumber) continue;
    const k = norm(e.employeeNumber);
    exact.set(k, [...(exact.get(k) ?? []), e]);
    if (/^\d+$/.test(k)) {
      const z = stripZeros(k);
      loose.set(z, [...(loose.get(z) ?? []), e]);
    }
  }
  return (raw: string) => {
    const k = norm(raw);
    const a = exact.get(k);
    if (a) return a.length === 1 ? { kind: 'ok', employee: a[0], zeroPadded: false } : { kind: 'ambiguous' };
    if (/^\d+$/.test(k)) {
      const b = loose.get(stripZeros(k));
      if (b) return b.length === 1 ? { kind: 'ok', employee: b[0], zeroPadded: true } : { kind: 'ambiguous' };
    }
    return { kind: 'none' };
  };
}

// ===== 取り込み =====

export type ImportErrorCode =
  | RowError
  | 'noEmployeeNumber'
  | 'unknownEmployee'
  | 'ambiguousEmployee'
  | 'badMonth'
  | 'notEmployed'
  | 'duplicate'
  | 'badProrated'
  | 'badState';

export interface ImportItem {
  line: number; // ファイルの行番号（見出しが1行目）
  employeeId: string;
  employeeLabel: string; // 確認画面に出す「社員番号 氏名」
  paidMonth: string;
  input: PayrollInput;
}

export interface ImportError {
  line: number;
  codes: ImportErrorCode[];
}

export interface ImportRead {
  missingColumns: PayrollColumn[];
  items: ImportItem[];
  errors: ImportError[];
  /** 先頭の0を補って照合した行 */
  zeroPadded: number[];
  /** 何も書いていない行（読み飛ばした） */
  blankLines: number;
  /** 社員番号と月だけで、数字が空の行（ひな形の未記入。読み飛ばした） */
  unfilledLines: number;
}

export function readPayrollCsv(
  rows: readonly (readonly string[])[],
  employees: readonly CsvEmployee[],
  schedule: PaySchedule,
): ImportRead {
  const result: ImportRead = {
    missingColumns: [],
    items: [],
    errors: [],
    zeroPadded: [],
    blankLines: 0,
    unfilledLines: 0,
  };
  if (rows.length === 0) {
    result.missingColumns = [...REQUIRED];
    return result;
  }
  const { index, missing } = mapHeader(rows[0]);
  if (missing.length > 0) {
    result.missingColumns = missing;
    return result;
  }
  const cell = (row: readonly string[], c: PayrollColumn) => {
    const i = index[c];
    return i === undefined ? '' : (row[i] ?? '');
  };
  const match = makeMatcher(employees);
  const seen = new Map<string, number>(); // 'employeeId|month' → 行番号

  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    if (isBlankRow(row)) {
      result.blankLines++;
      return;
    }
    const codes: ImportErrorCode[] = [];

    // 人
    const no = cell(row, 'employeeNumber');
    let employee: CsvEmployee | null = null;
    if (norm(no) === '') {
      codes.push('noEmployeeNumber');
    } else {
      const m = match(no);
      if (m.kind === 'none') codes.push('unknownEmployee');
      else if (m.kind === 'ambiguous') codes.push('ambiguousEmployee');
      else {
        employee = m.employee;
        if (m.zeroPadded) result.zeroPadded.push(line);
      }
    }

    // 月
    const paidMonth = parseMonth(cell(row, 'paidMonth'));
    if (!paidMonth) codes.push('badMonth');

    const prorated = parseFlag(cell(row, 'prorated'));
    if (prorated === undefined) codes.push('badProrated');
    const state = parseState(cell(row, 'state'));
    if (state === undefined) codes.push('badState');

    let periodDays = 31;
    if (employee && paidMonth) {
      const p = periodOf(paidMonth, schedule);
      periodDays = daysBetween(p.start, p.end);
      if (!employedDuring(employee, p)) codes.push('notEmployed');
      const key = `${employee.id}|${paidMonth}`;
      if (seen.has(key)) codes.push('duplicate');
      else seen.set(key, line);
    }

    // 数字（月の表と同じ読み方・同じチェック）
    const text: PayrollRowText = {
      cash: cell(row, 'cash'),
      fixed: cell(row, 'fixed'),
      inKind: cell(row, 'inKind'),
      retro: cell(row, 'retro'),
      days: cell(row, 'days'),
      absentDays: cell(row, 'absentDays'),
      hours: cell(row, 'hours'),
      prorated: prorated ?? false,
      state: state ?? 'normal',
    };
    const r = readRow(text, periodDays);
    if (r.kind === 'blank') {
      // ひな形の未記入の行：人や月が読めていれば読み飛ばす（ほかのエラーがあればエラー）
      if (codes.length === 0) {
        result.unfilledLines++;
        return;
      }
    } else if (r.kind === 'invalid') {
      codes.push(...r.errors);
    }

    if (codes.length > 0 || !employee || !paidMonth || r.kind !== 'ok') {
      result.errors.push({ line, codes });
      return;
    }
    result.items.push({
      line,
      employeeId: employee.id,
      employeeLabel: `${employee.employeeNumber ?? ''} ${employee.lastName} ${employee.firstName}`.trim(),
      paidMonth,
      input: r.input,
    });
  });
  return result;
}

/** 保存済みと比べて、新規・上書き・変わらないに分ける */
export function classifyImport(
  items: readonly ImportItem[],
  existing: ReadonlyMap<string, Payroll>, // 'employeeId|paidMonth' → 保存済み
): { created: ImportItem[]; updated: ImportItem[]; unchanged: ImportItem[] } {
  const created: ImportItem[] = [];
  const updated: ImportItem[] = [];
  const unchanged: ImportItem[] = [];
  for (const it of items) {
    const old = existing.get(`${it.employeeId}|${it.paidMonth}`);
    if (!old) created.push(it);
    else if (sameInput(old, it.input)) unchanged.push(it);
    else updated.push(it);
  }
  return { created, updated, unchanged };
}

// ===== 書き出し =====

/** from〜to の月（両端を含む。from > to なら空） */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/**
 * 書き出しの行（見出し＋1人×1か月）。期間に在籍していた人を、月の順・渡された人の順で並べる
 * 入力済みの月は数字入り、未入力の月は数字の欄が空（＝ ひな形）
 */
export function buildPayrollCsv(
  employees: readonly CsvEmployee[],
  payrolls: readonly Payroll[],
  months: readonly string[],
  schedule: PaySchedule,
  lang: CsvLang,
): string[][] {
  const saved = new Map(payrolls.map((p) => [`${p.employeeId}|${p.paidMonth}`, p]));
  const header = PAYROLL_COLUMNS.map((c) => PAYROLL_HEADERS[lang][c]);
  const rows: string[][] = [header];
  for (const month of months) {
    const p = periodOf(month, schedule);
    for (const e of employees) {
      if (!employedDuring(e, p)) continue;
      const s = saved.get(`${e.id}|${month}`);
      const v: Record<PayrollColumn, string> = {
        employeeNumber: e.employeeNumber ?? '',
        name: `${e.lastName} ${e.firstName}`,
        paidMonth: month,
        cash: s ? String(s.cash) : '',
        fixed: s ? String(s.fixed) : '',
        days: s ? String(s.days) : '',
        inKind: s && s.inKind ? String(s.inKind) : '',
        retro: s && s.retro ? String(s.retro) : '',
        absentDays: s?.absentDays != null ? String(s.absentDays) : '',
        hours: s?.workMinutes != null ? formatHours(s.workMinutes) : '',
        prorated: s?.prorated ? '1' : '',
        state: s ? STATE_LABELS[lang][s.state] : '',
      };
      rows.push(PAYROLL_COLUMNS.map((c) => v[c]));
    }
  }
  return rows;
}

/** 給与の実績_伊藤テスト中商事_2026-04〜2026-06_20261106.csv */
export function payrollFileName(officeName: string, from: string, to: string, today: string, lang: CsvLang): string {
  const title = lang === 'ja' ? '給与の実績' : 'payroll';
  const range = from === to ? from : `${from}〜${to}`;
  return `${title}_${officeName}_${range}_${today.replace(/-/g, '')}.csv`;
}
