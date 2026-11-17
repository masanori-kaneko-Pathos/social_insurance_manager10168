// 賞与の取り込み（ファイルの取り込みのページの「賞与」。11/17）
// 1行 ＝ 1人 × 1回の支給。同じ支払日の行を、1回の支給にまとめる
// すでに同じ支払日の支給があれば「足し込む」：ファイルにいる人の額は上書き、いない人の額はそのまま
// （差し替えにすると、ファイルに入れ忘れた人の額が黙って消えるため）
// Angular・Firebase に依存しない純粋な関数

import type { BonusPaymentInput } from '../../../core/models/bonus';
import { ImportField, normalizeDate, normalizeNumber, OurTableSpec } from '../../../shared/import/column-map';

export const BONUS_CSV_COLUMNS = ['employeeNumber', 'name', 'paidDate', 'title', 'amount', 'inKind'] as const;
export type BonusCsvColumn = (typeof BONUS_CSV_COLUMNS)[number];

export const BONUS_CSV_HEADERS: Record<BonusCsvColumn, string> = {
  employeeNumber: '社員番号',
  name: '氏名',
  paidDate: '支払日',
  title: '名称',
  amount: '賞与額',
  inKind: '現物',
};

/** 見出しの言い換え（賞与の登録の画面の「ファイルから読み込む」と同じ言い方も読む） */
export const BONUS_CSV_FIELDS: readonly ImportField<BonusCsvColumn>[] = [
  {
    key: 'employeeNumber',
    header: BONUS_CSV_HEADERS.employeeNumber,
    words: ['従業員番号', '従業員コード', '社員コード', '社員No', '職員番号', 'Employee number'],
    kind: 'digits',
    required: true,
    orFrom: ['name'],
  },
  { key: 'name', header: BONUS_CSV_HEADERS.name, words: ['従業員名', '社員名', '姓名', '名前', 'Name'] },
  {
    key: 'paidDate',
    header: BONUS_CSV_HEADERS.paidDate,
    words: ['支給日', '賞与支給日', '支払年月日', '支給年月日', 'Paid date', 'Payment date'],
    kind: 'date',
    required: true,
  },
  { key: 'title', header: BONUS_CSV_HEADERS.title, words: ['賞与名', '支給名', '賞与の名称', 'Title'] },
  {
    key: 'amount',
    header: BONUS_CSV_HEADERS.amount,
    words: ['賞与', '賞与支給額', '支給額', '賞与金額', '総支給額', '通貨', 'Bonus', 'Amount'],
    kind: 'number',
    required: true,
  },
  { key: 'inKind', header: BONUS_CSV_HEADERS.inKind, words: ['現物給与', '現物の額', 'In kind'], kind: 'number' },
];

export const BONUS_TABLE_SPEC: OurTableSpec<BonusCsvColumn, BonusCsvColumn> = {
  fields: BONUS_CSV_FIELDS,
  out: BONUS_CSV_COLUMNS,
  outHeader: (k) => BONUS_CSV_HEADERS[k],
};

/** ひな形（見出し ＋ 例2行。2人に同じ支給） */
export function bonusCsvTemplate(): string[][] {
  const row = (x: Partial<Record<BonusCsvColumn, string>>) => BONUS_CSV_COLUMNS.map((c) => x[c] ?? '');
  return [
    BONUS_CSV_COLUMNS.map((c) => BONUS_CSV_HEADERS[c]),
    row({ employeeNumber: 'E001', name: '山田 太郎', paidDate: '2026-07-10', title: '夏季賞与', amount: '500000' }),
    row({ employeeNumber: 'E002', name: '佐藤 花子', paidDate: '2026-07-10', title: '夏季賞与', amount: '420000', inKind: '10000' }),
  ];
}

export interface BonusCsvTarget {
  id: string;
  employeeNumber: string | null;
  lastName: string;
  firstName: string;
  hireDate: string;
  retireDate: string | null;
}

/** 登録済みの支給（足し込む先） */
export interface BonusExisting {
  id: string;
  paidDate: string;
  title: string | null;
  amounts: Readonly<Record<string, number>>;
  inKindAmounts?: Readonly<Record<string, number>>;
}

export type BonusCsvError =
  | 'employeeNotFound' // 社員番号（氏名）の人がいない
  | 'nameAmbiguous' // 氏名だけで、同じ氏名の人が何人もいる
  | 'paidDate' // 支払日が読めない
  | 'amount' // 賞与額が読めない・マイナス
  | 'inKind' // 現物が読めない・マイナス
  | 'duplicate'; // 同じ人・同じ支払日の行が前にもある

export type BonusCsvWarning =
  | 'beforeHire' // 支払日が入社日より前（保険料はかからない）
  | 'afterRetire' // 支払日が退職日より後（保険料はかからない）
  | 'titleDiffers'; // 同じ支払日で名称が違う（最初の名称を使う）

/** new：新しい支給／add：登録済みの支給に追加／update：額を上書き／same：変わらない */
export type BonusRowStatus = 'new' | 'add' | 'update' | 'same' | 'error';

export interface BonusCsvRow {
  line: number;
  employee: BonusCsvTarget | null;
  /** ファイルの社員番号か氏名（見つからないときに出す） */
  label: string;
  paidDate: string; // 読めなければ元の文字
  title: string;
  amount: number | null;
  inKind: number | null; // 空なら null（登録済みの現物はそのまま）
  errors: BonusCsvError[];
  warnings: BonusCsvWarning[];
  status: BonusRowStatus;
}

/** 支払日ごとの書き込み（create：新しく作る／update：足し込む） */
export interface BonusWrite {
  paidDate: string;
  existingId: string | null;
  input: BonusPaymentInput & { inKindAmounts: Record<string, number> };
  /** この書き込みで入れる人数（変わらない人は数えない） */
  count: number;
}

export interface BonusPlan {
  rows: BonusCsvRow[];
  /** エラーのない行から作った書き込み（変わらないだけの支払日は入れない） */
  writes: BonusWrite[];
}

const nameKey = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
const noKey = (s: string) => s.normalize('NFKC').trim().replace(/^0+(?=\d)/, '');

function realDate(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

/** 円（整数・0以上）。空は null、読めなければ NaN */
function yen(raw: string): number | null {
  const t = normalizeNumber(raw);
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return Number.NaN;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : Number.NaN;
}

/**
 * 表（1行目は うちの見出し）を読み、支払日ごとの書き込みを作る
 * 人は社員番号で探し、社員番号の列が空なら氏名で（同じ氏名が1人だけのとき）
 */
export function planBonusImport(
  table: readonly (readonly string[])[],
  targets: readonly BonusCsvTarget[],
  existing: readonly BonusExisting[],
): BonusPlan {
  const [head = [], ...body] = table;
  const index = new Map(head.map((h, i) => [h.replace(/^﻿/, '').trim(), i]));
  const col = (c: BonusCsvColumn) => index.get(BONUS_CSV_HEADERS[c]) ?? -1;

  const byNo = new Map<string, BonusCsvTarget>();
  const byName = new Map<string, BonusCsvTarget[]>();
  for (const t of targets) {
    if (t.employeeNumber) byNo.set(noKey(t.employeeNumber), t);
    const k = nameKey(`${t.lastName}${t.firstName}`);
    byName.set(k, [...(byName.get(k) ?? []), t]);
  }
  const existingByDate = new Map(existing.map((e) => [e.paidDate, e]));

  const rows: BonusCsvRow[] = [];
  const seen = new Set<string>();
  const firstTitle = new Map<string, string>();

  body.forEach((cells, i) => {
    const get = (c: BonusCsvColumn) => (col(c) >= 0 ? (cells[col(c)] ?? '') : '').trim();
    if (BONUS_CSV_COLUMNS.every((c) => get(c) === '')) return;
    const line = i + 2;
    const no = get('employeeNumber');
    const name = get('name');
    const errors: BonusCsvError[] = [];
    const warnings: BonusCsvWarning[] = [];

    let employee: BonusCsvTarget | null = no ? (byNo.get(noKey(no)) ?? null) : null;
    if (!employee && !no && name) {
      const list = byName.get(nameKey(name)) ?? [];
      if (list.length > 1) errors.push('nameAmbiguous');
      else employee = list[0] ?? null;
    }
    if (!employee && !errors.includes('nameAmbiguous')) errors.push('employeeNotFound');

    const paidDate = realDate(normalizeDate(get('paidDate')));
    if (!paidDate) errors.push('paidDate');

    const amount = yen(get('amount'));
    if (amount === null || Number.isNaN(amount)) errors.push('amount');
    const inKind = yen(get('inKind'));
    if (inKind !== null && Number.isNaN(inKind)) errors.push('inKind');

    if (employee && paidDate) {
      const key = `${employee.id}|${paidDate}`;
      if (seen.has(key)) errors.push('duplicate');
      seen.add(key);
      if (paidDate < employee.hireDate) warnings.push('beforeHire');
      else if (employee.retireDate && paidDate > employee.retireDate) warnings.push('afterRetire');
    }

    const title = get('title');
    if (paidDate && title) {
      const first = firstTitle.get(paidDate);
      if (first === undefined) firstTitle.set(paidDate, title);
      else if (first !== title) warnings.push('titleDiffers');
    }

    let status: BonusRowStatus = 'error';
    if (errors.length === 0 && employee && paidDate && amount !== null && !Number.isNaN(amount)) {
      const before = existingByDate.get(paidDate);
      if (!before) status = 'new';
      else if (!(employee.id in before.amounts)) status = 'add';
      else {
        const sameAmount = before.amounts[employee.id] === amount;
        const sameInKind = inKind === null || (before.inKindAmounts?.[employee.id] ?? 0) === inKind;
        status = sameAmount && sameInKind ? 'same' : 'update';
      }
    }

    rows.push({
      line,
      employee,
      label: no || name,
      paidDate: paidDate ?? get('paidDate'),
      title,
      amount: amount === null || Number.isNaN(amount) ? null : amount,
      inKind: inKind === null || Number.isNaN(inKind) ? null : inKind,
      errors,
      warnings,
      status,
    });
  });

  // 支払日ごとにまとめる（エラーの行は入れない。変わらない人だけの支払日は書かない）
  const groups = new Map<string, BonusCsvRow[]>();
  for (const r of rows) {
    if (r.status === 'error') continue;
    groups.set(r.paidDate, [...(groups.get(r.paidDate) ?? []), r]);
  }
  const writes: BonusWrite[] = [];
  for (const [paidDate, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const count = list.filter((r) => r.status !== 'same').length;
    if (count === 0) continue;
    const before = existingByDate.get(paidDate) ?? null;
    const amounts: Record<string, number> = { ...(before?.amounts ?? {}) };
    const inKindAmounts: Record<string, number> = { ...(before?.inKindAmounts ?? {}) };
    for (const r of list) {
      amounts[r.employee!.id] = r.amount!;
      if (r.inKind !== null) {
        if (r.inKind > 0) inKindAmounts[r.employee!.id] = r.inKind;
        else delete inKindAmounts[r.employee!.id];
      }
    }
    const fileTitle = firstTitle.get(paidDate) ?? '';
    writes.push({
      paidDate,
      existingId: before?.id ?? null,
      input: { paidDate, title: fileTitle || before?.title || null, amounts, inKindAmounts },
      count,
    });
  }
  return { rows, writes };
}

/** エラー → 直す列（共通の窓で上に出す） */
export function bonusFixColumns(errors: readonly BonusCsvError[]): BonusCsvColumn[] {
  const out = new Set<BonusCsvColumn>();
  for (const e of errors) {
    if (e === 'employeeNotFound' || e === 'nameAmbiguous') {
      out.add('employeeNumber');
      out.add('name');
    } else if (e === 'paidDate') out.add('paidDate');
    else if (e === 'amount') out.add('amount');
    else if (e === 'inKind') out.add('inKind');
    else if (e === 'duplicate') {
      out.add('employeeNumber');
      out.add('paidDate');
    }
  }
  return BONUS_CSV_COLUMNS.filter((c) => out.has(c));
}
