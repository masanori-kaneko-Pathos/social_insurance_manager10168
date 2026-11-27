// 給与の実績の CSV（取り込み・書き出し。往復できる同じ形）
// 1行 ＝ 1人 × 1か月。列は見出しの名前で読む（並び順は自由。日本語・英語どちらの見出しでもよい）

import { Payroll, PayrollInput, PayrollState } from '../../../core/models/payroll';
import { isBlankRow } from '../../../shared/csv/csv';
import { toHalfWidth } from '../../../shared/utils/text';
import { candidateDays, fixedBeforeOf, PayrollRowText, readEntry, RowError, sameInput } from './payroll-input';
import type { PayType } from '../../../core/models/contract';
import type { PayrollItemCategory, PayrollItemInput } from '../../../core/models/payroll-item';
import { categoryOf, FOR_MONTH_CATEGORIES, itemKey, LineDraft, readAmount, totalsOf } from './payroll-lines';
import { formatHours } from '../../../shared/utils/number';
import { employedDuring, PayrollEmployee, PaySchedule, periodOf, suggestDays } from './payroll-rows';
import { daysInclusive } from '../../../shared/utils/date';
import { DerivedSpec, ImportField, OurTableSpec, ValueKind } from '../../../shared/import/column-map';
import { byHeader, FixField, MONTH, NUMBER, select, YES_NO } from '../../../shared/import/fix-fields';

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
  | 'state'
  // 出勤日数：読むだけの列（書き出さない）。時給・日給の人の給与計算の基礎日数にする（11/25）
  | 'attendedDays';

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

/** 読む列（書き出す列＋出勤日数） */
export const PAYROLL_READ_COLUMNS: readonly PayrollColumn[] = [...PAYROLL_COLUMNS, 'attendedDays'];

export const PAYROLL_REQUIRED: readonly PayrollColumn[] = ['employeeNumber', 'paidMonth', 'cash', 'fixed', 'days'];
/**
 * 列がなくても読める必須の項目（11/25）
 * 給与計算の基礎日数は、空なら給与の形から出す（月給：対象期間の暦日。入社・退職の月は在籍した日／
 * 日給月給：所定労働日数 − 欠勤日数（欠勤がなければ暦日）／時給・日給：出勤日数）。明細の「出勤日数」は時給・日給の人にだけ使う
 */
const READ_DERIVED: readonly PayrollColumn[] = ['days'];

export type CsvLang = 'ja' | 'en';

export const PAYROLL_HEADERS: Record<CsvLang, Record<PayrollColumn, string>> = {
  ja: {
    employeeNumber: '社員番号',
    name: '氏名',
    paidMonth: '支払月',
    cash: '通貨によるものの額',
    fixed: 'うち固定的賃金',
    days: '給与計算の基礎日数',
    inKind: '現物によるものの額',
    retro: 'うち遡及支払額',
    absentDays: '欠勤日数',
    hours: '実労働時間',
    prorated: '日割りの月',
    state: '状態',
    attendedDays: '出勤日数',
  },
  en: {
    employeeNumber: 'Employee number',
    name: 'Name',
    paidMonth: 'Pay month',
    cash: 'Amount paid in money',
    fixed: 'Of which: fixed wages',
    days: 'Days in pay calculation',
    inKind: 'Amount paid in kind',
    retro: 'Of which: retroactive pay',
    absentDays: 'Days absent',
    hours: 'Hours worked',
    prorated: 'Pro-rated month',
    state: 'Status',
    attendedDays: 'Days worked',
  },
};

/**
 * 前の見出し。前に書き出したファイル・ひな形・評価用の CSV も、そのまま読めるようにする
 * 11/24 夕方に、月額変更届・算定基礎届の欄の名前（通貨によるものの額・現物によるものの額・遡及支払額・給与計算の基礎日数）へそろえた
 */
export const PAYROLL_OLD_HEADERS: Partial<Record<PayrollColumn, readonly string[]>> = {
  paidMonth: ['支払った月', 'Month paid'],
  cash: ['総支給額', 'Gross pay', '支払額', 'Paid in money'],
  fixed: ['固定的賃金', 'Fixed wages', 'うち毎月決まった額', 'Of which: same every month'],
  days: ['支払基礎日数', 'Payment basis days'],
  inKind: ['現物', 'In kind'],
  retro: ['うち昇給差額', 'Of which: back pay for a raise', '遡及支払額', 'Retroactive pay'],
  prorated: ['1か月分そろわない月', 'Partial month', '日割り', 'Prorated'],
};

/** その列として、そのまま読む見出し（今の日本語・英語＋前の見出し） */
export function payrollHeadersOf(col: PayrollColumn): string[] {
  return [PAYROLL_HEADERS.ja[col], PAYROLL_HEADERS.en[col], ...(PAYROLL_OLD_HEADERS[col] ?? [])];
}

/** 現物の欄の「内訳なし」（支払額に含まれていて分けた額がない）。書き出しはこの言葉、読むときは下の言い方も受け付ける */
export const IN_KIND_MERGED_LABEL: Record<CsvLang, string> = { ja: '内訳なし', en: 'Included in pay' };
const IN_KIND_MERGED_WORDS = ['内訳なし', '合計に含む', '支払額に含む', 'includedinpay', 'included'];

/** 現物の欄が「内訳なし」を表しているか */
export function isInKindMerged(s: string): boolean {
  const k = toHalfWidth(s).trim().toLowerCase().replace(/\s+/g, '');
  return k !== '' && IN_KIND_MERGED_WORDS.includes(k);
}

const STATE_LABELS: Record<CsvLang, Record<PayrollState, string>> = {
  ja: { normal: '通常', suspended: '休職', furlough: '一時帰休' },
  en: { normal: 'Normal', suspended: 'Leave of absence', furlough: 'Temporary layoff' },
};

const norm = (s: string) =>
  toHalfWidth(s)
    .replace(/[ー‐]/g, '-') // 長音・ハイフンのような文字
    .trim();

const headerKey = (s: string) => norm(s).toLowerCase().replace(/\s+/g, '');

/** 見出しの行 → 列の位置。知らない列は無視する */
export function mapHeader(header: readonly string[]): {
  index: Partial<Record<PayrollColumn, number>>;
  missing: PayrollColumn[];
} {
  const lookup = new Map<string, PayrollColumn>();
  for (const col of PAYROLL_READ_COLUMNS) for (const h of payrollHeadersOf(col)) lookup.set(headerKey(h), col);
  const index: Partial<Record<PayrollColumn, number>> = {};
  header.forEach((h, i) => {
    const col = lookup.get(headerKey(h));
    if (col && index[col] === undefined) index[col] = i;
  });
  return { index, missing: PAYROLL_REQUIRED.filter((c) => index[c] === undefined && !READ_DERIVED.includes(c)) };
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
    if (a)
      return a.length === 1
        ? { kind: 'ok', employee: a[0], zeroPadded: false }
        : { kind: 'ambiguous' };
    if (/^\d+$/.test(k)) {
      const b = loose.get(stripZeros(k));
      if (b)
        return b.length === 1
          ? { kind: 'ok', employee: b[0], zeroPadded: true }
          : { kind: 'ambiguous' };
    }
    return { kind: 'none' };
  };
}

/** 氏名を比べるためにそろえる（全角半角・空白の違いを無視） */
const nameKey = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');

/**
 * 氏名で照合する（社員番号は任意の項目なので、番号のない人のため）。
 * 同じ氏名が2人以上なら ambiguous（社員番号を入れてもらう）
 */
export function makeNameMatcher(employees: readonly CsvEmployee[]): (name: string) => Match {
  const byName = new Map<string, CsvEmployee[]>();
  for (const e of employees) {
    const k = nameKey(`${e.lastName}${e.firstName}`);
    if (k) byName.set(k, [...(byName.get(k) ?? []), e]);
  }
  return (raw: string) => {
    const a = byName.get(nameKey(raw));
    if (!a) return { kind: 'none' };
    return a.length === 1 ? { kind: 'ok', employee: a[0], zeroPadded: false } : { kind: 'ambiguous' };
  };
}

/**
 * 対象期間の決まり：事業所で1つ、または人と支払月ごと（給与の支払区分。11/24）
 */
export type ScheduleSource = PaySchedule | ((employeeId: string, paidMonth: string) => PaySchedule);

export function scheduleFor(s: ScheduleSource, employeeId: string, paidMonth: string): PaySchedule {
  return typeof s === 'function' ? s(employeeId, paidMonth) : s;
}

// ===== 取り込み =====

export type ImportErrorCode =
  | RowError
  | 'noEmployeeNumber'
  | 'unknownEmployee'
  | 'ambiguousEmployee'
  | 'unknownName'
  | 'ambiguousName'
  | 'badMonth'
  | 'notEmployed'
  | 'duplicate'
  | 'badProrated'
  | 'badState'
  // 内訳の列の合計が、総支給額の列と合わない（列が抜けている・総支給額に別のものが入っている。11/24）
  | 'linesMismatch'
  // 本来の月の列（見出しの [YYYY-MM]）に、支払月と同じか後の月の金額がある（11/24）
  | 'badForMonth';

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
  /** 現物の列があったか（ないときは、画面で「現物はない／支払額に含まれている」を選んでもらう） */
  hasInKindColumn: boolean;
}

/** 給与の内訳の列（見出しが給与の項目名に当たる列。11/24） */
interface LineColumn {
  index: number;
  name: string;
  category: PayrollItemCategory;
  /** 本来の月（見出しの後ろの [YYYY-MM]。払い忘れ・計算誤りの精算。なければ null） */
  forMonth: string | null;
}

/** 本来の月の列の見出し：「家族手当[2026-04]」（全角の［］も読む。11/24） */
const FOR_MONTH_HEADER = /^(.*?)\s*[\[［]\s*(\d{4})-(0[1-9]|1[0-2])\s*[\]］]$/;

/** 見出し → 項目名と本来の月 */
export function splitLineHeader(h: string): { name: string; forMonth: string | null } {
  const m = FOR_MONTH_HEADER.exec(h.trim());
  return m ? { name: m[1].trim(), forMonth: `${m[2]}-${m[3]}` } : { name: h.trim(), forMonth: null };
}

/** 項目名と本来の月 → 見出し */
export function lineHeaderOf(name: string, forMonth: string | null | undefined): string {
  return forMonth ? `${name}[${forMonth}]` : name;
}

/**
 * 見出しのうち、うちの列でなく、給与の項目名（事業所の項目・よくある名前・CSVの見出し）に当たる列
 * 例：基本給・固定残業手当・非課税通勤手当・欠勤控除。当たらない見出しは今までどおり読み飛ばす
 */
export function lineColumnsOf(
  header: readonly string[],
  used: ReadonlySet<number>,
  items: readonly PayrollItemInput[],
): LineColumn[] {
  const out: LineColumn[] = [];
  header.forEach((h, index) => {
    if (used.has(index)) return;
    const { name, forMonth } = splitLineHeader(h);
    const category = name ? categoryOf(name, items) : null;
    if (category) out.push({ index, name, category, forMonth: forMonth && FOR_MONTH_CATEGORIES.includes(category) ? forMonth : null });
  });
  return out;
}

export interface ReadOptions {
  /** 給与の項目（内訳の列を見分ける。11/24。なければよくある名前だけで見分ける） */
  items?: readonly PayrollItemInput[];
  /** その人のその月の給与の形（基本給を固定的賃金に数えるか。分からなければ null ＝ 月給と見る） */
  payTypeOf?: (employeeId: string, paidMonth: string) => PayType | null;
  /** その人のその月の契約の月の所定労働日数（日給月給の人の、欠勤がある月の基礎日数。分からなければ null） */
  scheduledDaysOf?: (employeeId: string, paidMonth: string) => number | null;
  /**
   * 現物の列がないファイルの扱い
   * - zero：現物はない（0）
   * - merged：給与ソフトが支払額に足して出している（内訳なし）
   */
  inKindMissing?: 'zero' | 'merged';
}

export function readPayrollCsv(
  rows: readonly (readonly string[])[],
  employees: readonly CsvEmployee[],
  schedule: ScheduleSource,
  opts: ReadOptions = {},
): ImportRead {
  const result: ImportRead = {
    missingColumns: [],
    items: [],
    errors: [],
    zeroPadded: [],
    blankLines: 0,
    unfilledLines: 0,
    hasInKindColumn: false,
  };
  if (rows.length === 0) {
    result.missingColumns = [...PAYROLL_REQUIRED];
    return result;
  }
  const { index, missing: missingOurs } = mapHeader(rows[0]);
  // 内訳の列があれば、総支給額・固定的賃金は内訳から出すので、列がなくてもよい（11/24）
  const lineCols = lineColumnsOf(rows[0], new Set(Object.values(index) as number[]), opts.items ?? []);
  const missing = lineCols.length > 0 ? missingOurs.filter((c) => c !== 'cash' && c !== 'fixed') : missingOurs;
  if (missing.length > 0) {
    result.missingColumns = missing;
    return result;
  }
  result.hasInKindColumn = index.inKind !== undefined;
  const mergedWhenNoColumn = !result.hasInKindColumn && opts.inKindMissing === 'merged';
  const cell = (row: readonly string[], c: PayrollColumn) => {
    const i = index[c];
    return i === undefined ? '' : (row[i] ?? '');
  };
  const match = makeMatcher(employees);
  const matchName = makeNameMatcher(employees);
  const seen = new Map<string, number>(); // 'employeeId|month' → 行番号

  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    if (isBlankRow(row)) {
      result.blankLines++;
      return;
    }
    const codes: ImportErrorCode[] = [];

    // 人：社員番号で探す。番号が空なら氏名で探す（社員番号は任意の項目のため）
    const no = cell(row, 'employeeNumber');
    const name = cell(row, 'name');
    let employee: CsvEmployee | null = null;
    if (norm(no) === '') {
      if (nameKey(name) === '') codes.push('noEmployeeNumber');
      else {
        const m = matchName(name);
        if (m.kind === 'none') codes.push('unknownName');
        else if (m.kind === 'ambiguous') codes.push('ambiguousName');
        else employee = m.employee;
      }
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
    /** 在籍した日（入社・退職の月は日割り。月給の人の基礎日数の候補） */
    let employedDays: number | null = null;
    if (employee && paidMonth) {
      const p = periodOf(paidMonth, scheduleFor(schedule, employee.id, paidMonth));
      periodDays = daysInclusive(p.start, p.end);
      employedDays = suggestDays(employee, p);
      if (!employedDuring(employee, p)) codes.push('notEmployed');
      const key = `${employee.id}|${paidMonth}`;
      if (seen.has(key)) codes.push('duplicate');
      else seen.set(key, line);
    }

    // 数字（月の表と同じ読み方・同じチェック）
    const text: PayrollRowText = {
      cash: cell(row, 'cash'),
      fixed: cell(row, 'fixed'),
      inKind: isInKindMerged(cell(row, 'inKind')) ? '' : cell(row, 'inKind'),
      inKindMerged: mergedWhenNoColumn || isInKindMerged(cell(row, 'inKind')),
      retro: cell(row, 'retro'),
      days: cell(row, 'days'),
      absentDays: cell(row, 'absentDays'),
      hours: cell(row, 'hours'),
      prorated: prorated ?? false,
      state: state ?? 'normal',
    };
    // 内訳の列がある：その列から内訳を読み、総支給額などは内訳から出す。金額が1つもなければ今までどおり
    const drafts: LineDraft[] | null =
      lineCols.length > 0 ? lineCols.map((c) => ({ name: c.name, category: c.category, amount: row[c.index] ?? '', forMonth: c.forMonth })) : null;
    // 本来の月は、支払月より前の月だけ（同じ月・後の月の精算はない）
    if (paidMonth && lineCols.some((c) => c.forMonth && c.forMonth >= paidMonth && (row[c.index] ?? '').trim() !== '')) {
      codes.push('badForMonth');
    }
    const payType = employee && paidMonth && opts.payTypeOf ? opts.payTypeOf(employee.id, paidMonth) : null;
    // 給与計算の基礎日数が空：給与の形から出す（手入力の画面の候補と同じ決まり。11/25）
    // 金額が1つもない行（書き出した未入力の月）は、未記入のまま読み飛ばせるように出さない
    const hasAmount =
      [text.cash, text.fixed, text.inKind, text.retro].some((v) => v.trim() !== '') ||
      (drafts ?? []).some((d) => d.amount.trim() !== '');
    if (text.days.trim() === '' && hasAmount && employee && paidMonth) {
      text.days = derivedDays(payType, employedDays ?? periodDays, text.absentDays, cell(row, 'attendedDays'),
        opts.scheduledDaysOf?.(employee.id, paidMonth) ?? null);
    }
    const r = readEntry(text, drafts, payType, periodDays);
    // 総支給額の列も書いてあれば、内訳の合計と合うかを見る（列の抜け・別のものの混入に気づくため）
    if (r.kind === 'ok' && r.input.lines && text.cash.trim() !== '') {
      const written = Number(text.cash.normalize('NFKC').replace(/[,，円\s]/g, ''));
      if (Number.isFinite(written) && written !== r.input.cash) codes.push('linesMismatch');
    }
    if (r.kind === 'blank') {
      // ひな形の未記入の行：人や月が読めていれば読み飛ばす（ほかのエラーがあればエラー）。
      // 番号が空で氏名でも決まらない行も、保存するものがないので読み飛ばす
      // （番号が入っていて未登録の行は、打ち間違いを見逃さないようエラーのまま）
      const noOneToSave = codes.every((c) => c === 'noEmployeeNumber' || c === 'unknownName' || c === 'ambiguousName');
      if (codes.length === 0 || noOneToSave) {
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
      employeeLabel:
        `${employee.employeeNumber ?? ''} ${employee.lastName} ${employee.firstName}`.trim(),
      paidMonth,
      input: r.input,
    });
  });
  return result;
}

/**
 * 給与計算の基礎日数を給与の形から出す（列が空のとき。11/25）
 * - 月給：対象期間の暦日（入社・退職の月は在籍した日）
 * - 日給月給：欠勤があれば所定労働日数 − 欠勤日数、なければ暦日（candidateDays と同じ）
 * - 時給・日給：出勤日数の列（なければ空 ＝「入っていません」のエラー）
 * 給与の形が分からない人は月給と見る
 */
export function derivedDays(payType: PayType | null, employedDays: number, absentText: string, attendedText: string, scheduledDays: number | null): string {
  if (payType === 'hourly' || payType === 'daily') return attendedText.trim();
  return String(candidateDays(employedDays, absentText, payType ?? 'monthly', scheduledDays));
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
    // 内訳の列がない CSV：数字が同じなら、保存済みの内訳を消さないよう「変わらない」にする（11/24）
    else if (sameInput(it.input.lines ? old : { ...old, lines: null, fixedFull: null }, it.input)) unchanged.push(it);
    else updated.push(it);
  }
  return { created, updated, unchanged };
}

// ===== 書き出し =====

/** 書き出す1行のもと（1人 × 1か月。saved がなければ未入力の月） */
export interface PayrollExportRow<E extends CsvEmployee = CsvEmployee> {
  employee: E;
  month: string;
  saved: Payroll | null;
}

/** 期間に在籍していた人を、月の順・渡された人の順で並べる（今の CSV と「項目を選んで出力」で共通。11/24） */
export function payrollExportRows<E extends CsvEmployee>(
  employees: readonly E[],
  payrolls: readonly Payroll[],
  months: readonly string[],
  schedule: ScheduleSource,
): PayrollExportRow<E>[] {
  const saved = new Map(payrolls.map((p) => [`${p.employeeId}|${p.paidMonth}`, p]));
  const out: PayrollExportRow<E>[] = [];
  for (const month of months) {
    for (const e of employees) {
      if (!employedDuring(e, periodOf(month, scheduleFor(schedule, e.id, month)))) continue;
      out.push({ employee: e, month, saved: saved.get(`${e.id}|${month}`) ?? null });
    }
  }
  return out;
}

/** 1行の各列の文字（入力済みの月は数字入り、未入力の月は数字の欄が空） */
export function payrollCells(r: PayrollExportRow, lang: CsvLang): Record<PayrollColumn, string> {
  const { employee: e, saved: s } = r;
  return {
    employeeNumber: e.employeeNumber ?? '',
    name: `${e.lastName} ${e.firstName}`,
    paidMonth: r.month,
    cash: s ? String(s.cash) : '',
    fixed: s ? String(fixedBeforeOf(s)) : '', // 欠勤控除を引く前（取り込みと同じ意味。A2）
    days: s ? String(s.days) : '',
    inKind: !s ? '' : s.inKind === null ? IN_KIND_MERGED_LABEL[lang] : s.inKind ? String(s.inKind) : '',
    retro: s && s.retro ? String(s.retro) : '',
    absentDays: s?.absentDays != null ? String(s.absentDays) : '',
    hours: s?.workMinutes != null ? formatHours(s.workMinutes) : '',
    prorated: s?.prorated ? '1' : '',
    state: s ? STATE_LABELS[lang][s.state] : '',
    attendedDays: '',
  };
}

/**
 * 書き出しの行（見出し＋1人×1か月）。期間に在籍していた人を、月の順・渡された人の順で並べる
 * 入力済みの月は数字入り、未入力の月は数字の欄が空（＝ ひな形）
 */
export function buildPayrollCsv(
  employees: readonly CsvEmployee[],
  payrolls: readonly Payroll[],
  months: readonly string[],
  schedule: ScheduleSource,
  lang: CsvLang,
  lineNames: readonly string[] = [],
): string[][] {
  const header = [...PAYROLL_COLUMNS.map((c) => PAYROLL_HEADERS[lang][c]), ...lineNames];
  const rows = payrollExportRows(employees, payrolls, months, schedule).map((r) => {
    const v = payrollCells(r, lang);
    return [...PAYROLL_COLUMNS.map((c) => v[c]), ...lineNames.map((n) => lineAmount(r.saved, n))];
  });
  return [header, ...rows];
}

/**
 * 書き出す内訳の列（11/24）：事業所のひな形の順 → 保存済みの内訳に出てくる順。同じ名前は1つ
 * この列のまま取り込めば、内訳ごと戻る（総支給額の列と合うかも確かめる）
 */
export function exportLineNames(payrolls: readonly Payroll[], template: readonly string[] | null): string[] {
  const out: string[] = [];
  const add = (n: string) => {
    if (!out.some((o) => itemKey(o) === itemKey(n))) out.push(n);
  };
  const used = payrolls.some((p) => p.lines && p.lines.length > 0);
  if (!used && !template) return [];
  for (const n of template ?? []) add(n);
  for (const p of payrolls) for (const l of p.lines ?? []) add(lineHeaderOf(l.name, l.forMonth));
  return out;
}

/** その行のその項目の金額（同じ名前・同じ本来の月の行は足す。なければ空） */
function lineAmount(s: Payroll | null, header: string): string {
  const { name, forMonth } = splitLineHeader(header);
  const hit = (s?.lines ?? []).filter((l) => itemKey(l.name) === itemKey(name) && (l.forMonth ?? null) === forMonth);
  return hit.length > 0 ? String(hit.reduce((a, l) => a + l.amount, 0)) : '';
}

/** 給与_伊藤テスト中商事_2026-04〜2026-06_20261106.csv（画面の名前「給与」に合わせた。11/24） */
export function payrollFileName(
  officeName: string,
  from: string,
  to: string,
  today: string,
  lang: CsvLang,
): string {
  const title = lang === 'ja' ? '給与' : 'payroll';
  const range = from === to ? from : `${from}〜${to}`;
  return `${title}_${officeName}_${range}_${today.replace(/-/g, '')}.csv`;
}

// ===== よそのファイルからの取り込み（列を合わせる画面で使う） =====
// 給与ソフトの書き出しの、よくある見出しの言い方

const WORDS: Record<PayrollColumn, readonly string[]> = {
  employeeNumber: ['従業員番号', '従業員コード', '社員コード', '社員No', '職員番号'],
  name: ['従業員名', '社員名', '姓名'],
  // 「対象年月」（○月分）は、翌月払いだと支払月とずれるので結ばない（11/24）
  paidMonth: ['支給年月', '支給月', '支払年月', '支給日', '支払日', '給与支給日'],
  cash: ['総支給金額', '支給合計', '支給額合計', '社保対象額', '社会保険対象額', '社会保険の報酬', '報酬額'],
  // 「固定給」「毎月決まった額」は基本給だけ・通勤手当を含まないことが多いので、似た列として聞く（NEAR。11/25）
  fixed: ['固定的賃金計', '固定的賃金の合計'],
  // 「出勤日数」は給与計算の基礎日数に結ばない（月給の人の基礎日数は暦日で、意味が違う。11/25）
  days: ['基礎日数', '支払基礎日数', '支払日数'],
  inKind: ['現物給与', '現物支給額', '現物給与額'],
  retro: ['遡及額', '遡及分', '昇給差額'],
  absentDays: ['欠勤'],
  // 実労働時間は「所定＋法定内の残業」。総労働時間などは法定外の残業も含むので、似た列として聞く（NEAR。11/25）
  hours: [],
  prorated: [],
  state: [],
  attendedDays: ['出勤日', '勤務日数', '労働日数', '出勤日数計', 'days worked'],
};

/** 似ているけれど意味が違うことがある見出し（自動では結ばず、列を合わせる画面で確かめてもらう。11/25） */
const NEAR: Partial<Record<PayrollColumn, ImportField['near']>> = {
  fixed: [{ words: ['固定給', '毎月決まった額'], noteKey: 'payrollCsv.near.fixed' }],
  retro: [{ words: ['差額支給'], noteKey: 'payrollCsv.near.retro' }],
  hours: [{ words: ['労働時間', '総労働時間', '勤務時間'], noteKey: 'payrollCsv.near.hours' }],
};
/** 時給・日給の基礎日数は有給休暇を含む（ガイドブック）。明細で分かれていれば出勤日数に足す */
const PAID_LEAVE_WORDS = ['有給日数', '有休日数', '有給休暇日数', '有給取得日数', '有休取得日数', '年休日数'];

const KINDS: Partial<Record<PayrollColumn, ValueKind>> = {
  paidMonth: 'month', cash: 'number', fixed: 'number', inKind: 'number', retro: 'number',
  days: 'days', absentDays: 'days', attendedDays: 'days',
};

export const PAYROLL_IMPORT_FIELDS: readonly ImportField<PayrollColumn>[] = PAYROLL_READ_COLUMNS.map((key) => ({
  key,
  header: PAYROLL_HEADERS.ja[key],
  words: [PAYROLL_HEADERS.en[key], ...(PAYROLL_OLD_HEADERS[key] ?? []), ...WORDS[key]],
  kind: KINDS[key],
  required: PAYROLL_REQUIRED.includes(key),
  // 社員番号の列がないファイルでも、氏名の列があれば氏名で照合する（うちの表には空の社員番号の列が出る）
  orFrom: key === 'employeeNumber' ? (['name'] as const) : undefined,
  near: NEAR[key],
  summable: key === 'attendedDays' || undefined,
  autoPlus: key === 'attendedDays' ? PAID_LEAVE_WORDS : undefined,
}));

/**
 * うちの見出しのままのファイルか（列を合わせる画面を出さずに、そのまま確認の画面へ進めるか。11/25）
 * 内訳の列（基本給・通勤手当など給与の項目名）があれば、通貨によるものの額・うち固定的賃金の列はなくてよい（readPayrollCsv と同じ決まり）
 */
export function isOurPayrollFormat(header: readonly string[], items: readonly PayrollItemInput[]): boolean {
  const { index, missing } = mapHeader(header);
  const lines = lineColumnsOf(header, new Set(Object.values(index) as number[]), items);
  const need = lines.length > 0 ? missing.filter((c) => c !== 'cash' && c !== 'fixed') : missing;
  return need.length === 0;
}

/**
 * 列を合わせる画面：明細の内訳の列（給与の項目名に当たる見出し）があれば、通貨によるものの額・うち固定的賃金は内訳から計算する（11/25）
 * 計算は読み取り（totalsOf）と同じ
 */
export function payrollDerived(headers: readonly string[], items: readonly PayrollItemInput[]): DerivedSpec<PayrollColumn> {
  const cols = lineColumnsOf(headers, new Set(), items).filter((c) => c.category !== 'excluded');
  // 給与計算の基礎日数は、列がなくてもいつも給与の形から出せる（derivedDays）
  const explain = { days: 'payrollCsv.daysDerived' };
  if (cols.length === 0) return { keys: ['days'], explain, formula: () => ({}) };
  return {
    keys: ['cash', 'fixed', 'days'],
    explain,
    noteKey: 'payrollCsv.derivedNote',
    formula: (cells) => {
      const lines = cols.flatMap((c) => {
        const amount = readAmount(cells[c.index] ?? '', c.category);
        return amount ? [{ name: c.name, category: c.category, amount, forMonth: c.forMonth }] : [];
      });
      const t = totalsOf(lines, null);
      const signed = (l: (typeof lines)[number]) => ({ name: l.name, amount: l.category === 'deduction' ? -l.amount : l.amount });
      const FIXED: readonly PayrollItemCategory[] = ['base', 'fixedAllowance', 'commute']; // 欠勤控除を引く前（A2）
      return {
        cash: { terms: lines.map(signed), total: t.cash },
        fixed: { terms: lines.filter((l) => FIXED.includes(l.category) && !l.forMonth).map(signed), total: t.fixedBefore },
      };
    },
  };
}

export const PAYROLL_TABLE_SPEC: OurTableSpec<PayrollColumn, PayrollColumn> = {
  fields: PAYROLL_IMPORT_FIELDS,
  out: PAYROLL_READ_COLUMNS,
  outHeader: (c) => PAYROLL_HEADERS.ja[c],
};

/** エラーのコード → 画面で直す欄（11/16。取り込み画面の「その場で直す」） */
export const PAYROLL_FIX: Readonly<Record<string, readonly PayrollColumn[]>> = {
  linesMismatch: ['cash'],
  badForMonth: ['paidMonth'],
  noEmployeeNumber: ['employeeNumber', 'name'],
  unknownEmployee: ['employeeNumber'],
  ambiguousEmployee: ['employeeNumber'],
  unknownName: ['employeeNumber', 'name'],
  ambiguousName: ['employeeNumber', 'name'],
  badMonth: ['paidMonth'],
  notEmployed: ['paidMonth'],
  duplicate: ['employeeNumber', 'paidMonth'],
  badProrated: ['prorated'],
  badState: ['state'],
  unreadable: ['cash', 'fixed', 'inKind', 'retro'],
  notInteger: ['cash', 'fixed', 'inKind', 'retro'],
  tooLarge: ['cash', 'fixed', 'inKind', 'retro'],
  cashRequired: ['cash'],
  fixedRequired: ['fixed'],
  daysRequired: ['days'],
  fixedOverCash: ['cash', 'fixed'],
  retroOverTotal: ['retro'],
  daysOutOfRange: ['days'],
  absentOutOfRange: ['absentDays'],
  minutesOutOfRange: ['hours'],
};

/** その列として受け付ける見出し（日本語・英語） */
export function payrollLabels(column: string): string[] {
  const c = column as PayrollColumn;
  return PAYROLL_HEADERS.ja[c] ? payrollHeadersOf(c) : [column];
}

// ===== 取り込みのエラーを窓で直すときの欄の種類（11/17。日本語・英語の見出しの両方） =====
export const PAYROLL_FIX_FIELDS: Record<string, FixField> = (() => {
  const fields: Partial<Record<PayrollColumn, FixField>> = {
    paidMonth: MONTH,
    cash: NUMBER,
    fixed: NUMBER,
    days: NUMBER,
    inKind: NUMBER,
    retro: NUMBER,
    absentDays: NUMBER,
    hours: NUMBER,
    prorated: YES_NO,
    state: select((Object.keys(STATE_LABELS.ja) as PayrollState[]).map((k) => ({ value: STATE_LABELS.ja[k], label: STATE_LABELS.ja[k] }))),
  };
  const old = Object.fromEntries(
    Object.entries(PAYROLL_OLD_HEADERS).flatMap(([c, hs]) => (fields[c as PayrollColumn] ? hs!.map((h) => [h, fields[c as PayrollColumn]!]) : [])),
  ) as Record<string, FixField>;
  return { ...byHeader(PAYROLL_HEADERS.ja, fields), ...byHeader(PAYROLL_HEADERS.en, fields), ...old };
})();

/**
 * 取り込むファイルの、支払月ごとの人数と「通貨によるものの額」の合計（11/26）
 * 取り込む前に、給与ソフトの支給総額と同じかを見比べてもらう（報酬にならない項目は通貨によるものの額に入らないので、その分は違ってよい）
 * 新規・上書き・変わらない行を全部数える（ファイル全体を見比べるため）。新しい月が先
 */
export function monthTotalsOf(items: readonly ImportItem[]): { month: string; count: number; cash: number }[] {
  const by = new Map<string, { count: number; cash: number }>();
  for (const it of items) {
    const t = by.get(it.paidMonth) ?? { count: 0, cash: 0 };
    t.count += 1;
    t.cash += it.input.cash;
    by.set(it.paidMonth, t);
  }
  return [...by.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, t]) => ({ month, ...t }));
}
