// 社会保障協定の適用証明書・海外勤務の取り込み（B9。11/17）
// - 相手国の適用証明書：協定の国から日本へ来ている外国籍の人（従業員の foreign.certificate。1人1枚）
// - 海外勤務：日本から海外へ赴任・出向する人（従業員の overseas。何件でも）
// どちらも社員番号で登録済みの従業員に結ぶ。画面の入力と同じチェック（agreement.ts・overseas.ts）を通す
// Angular・Firebase に依存しない純粋な関数

import type { AgreementCovers, CertificateDoc, Overseas, OverseasPayer } from '../../../core/models/employee';
import { isBlankRow } from '../../../shared/csv/csv';
import { DATE_RE } from '../../../shared/utils/date';
import { toHalfWidth } from '../../../shared/utils/text';
import { AgreementLike, certificateWarnings, CertificateWarning, defaultCovers } from './agreement';
import { readDate } from './employee-csv';
import { ageReachDate } from './coverage';
import { fromOverseasForm, OverseasFormValue, overseasErrors, overseasOverlaps, overseasWarnings, OverseasWarning } from './overseas';

export type AbroadKind = 'certificate' | 'overseas';

export const CERTIFICATE_CSV_HEADERS = {
  employeeNumber: '社員番号',
  name: '氏名',
  country: '証明書の国',
  covers: '証明書の範囲',
  from: '証明書の期間（から）',
  to: '証明書の期間（まで）',
} as const;

export const OVERSEAS_CSV_HEADERS = {
  employeeNumber: '社員番号',
  name: '氏名',
  country: '勤務する国',
  from: '赴任した日',
  to: '帰任した日',
  payer: '給与を払う会社',
  certificateFrom: '適用証明書の期間（始まり）',
  certificateTo: '適用証明書の期間（終わり）',
  note: 'メモ',
} as const;

export type CertificateColumn = keyof typeof CERTIFICATE_CSV_HEADERS;
export type OverseasColumn = keyof typeof OVERSEAS_CSV_HEADERS;
export type AbroadColumn = CertificateColumn | OverseasColumn;

export function abroadHeaders(kind: AbroadKind): Record<string, string> {
  return kind === 'certificate' ? CERTIFICATE_CSV_HEADERS : OVERSEAS_CSV_HEADERS;
}

const REQUIRED: Record<AbroadKind, readonly AbroadColumn[]> = {
  certificate: ['employeeNumber', 'country', 'from'],
  overseas: ['employeeNumber', 'country', 'from'],
};

/** 見出しの言い換え（記号・空白は無視） */
const WORDS: Partial<Record<AbroadColumn, readonly string[]>> = {
  employeeNumber: ['従業員番号', '社員コード', '社員No'],
  name: ['従業員名', '社員名'],
  country: ['国', '国・地域', '相手国', '派遣先の国', '赴任先', '赴任先の国'],
  covers: ['範囲', '免除の範囲', '証明書の種類'],
  from: ['証明書の期間から', '開始日', '赴任日', '派遣開始日', '適用開始日'],
  to: ['証明書の期間まで', '終了日', '帰任日', '帰任予定日', '派遣終了日', '適用終了日'],
  payer: ['給与の支払', '給与を払う', '給与支払者'],
  certificateFrom: ['日本の適用証明書の始まり', '証明書の始まり'],
  certificateTo: ['日本の適用証明書の終わり', '証明書の終わり'],
  note: ['備考'],
};

const key = (s: string) =>
  toHalfWidth(s.replace(/^﻿/, ''))
    .normalize('NFKC')
    .replace(/[\s_・()（）]/g, '')
    .toLowerCase();

function indexOf(kind: AbroadKind, header: readonly string[]): Partial<Record<AbroadColumn, number>> {
  const headers = abroadHeaders(kind);
  const lookup = new Map<string, AbroadColumn>();
  for (const [c, h] of Object.entries(headers) as [AbroadColumn, string][]) {
    lookup.set(key(h), c);
    for (const w of WORDS[c] ?? []) if (!lookup.has(key(w))) lookup.set(key(w), c);
  }
  const index: Partial<Record<AbroadColumn, number>> = {};
  header.forEach((h, i) => {
    const c = lookup.get(key(h));
    if (c && index[c] === undefined) index[c] = i;
  });
  return index;
}

const COVERS: Record<string, AgreementCovers> = {
  年金だけ: 'pension', 年金のみ: 'pension', 年金: 'pension', pension: 'pension',
  年金と医療: 'pensionAndHealth', '年金・医療': 'pensionAndHealth', 年金医療: 'pensionAndHealth', 医療も: 'pensionAndHealth',
  pensionandhealth: 'pensionAndHealth',
};
const PAYER: Record<string, OverseasPayer> = {
  日本の会社だけ: 'japan', 日本だけ: 'japan', 日本: 'japan', japan: 'japan',
  日本と海外の会社の両方: 'both', 両方: 'both', 日本と海外: 'both', both: 'both',
  海外の会社だけ: 'abroad', 海外だけ: 'abroad', 海外: 'abroad', abroad: 'abroad',
};

export interface AbroadTarget {
  id: string;
  employeeNumber: string | null;
  lastName: string;
  firstName: string;
  /** 外国籍の情報があるか（相手国の証明書は、外国籍の人だけ） */
  foreign: boolean;
  certificate: CertificateDoc | null;
  overseas: readonly Overseas[];
  /** 海外勤務の注意（介護保険の年齢・適用除外）に使う */
  birthDate: string;
  careExemptions: readonly { reason: string; from: string; to: string | null }[];
}

export type AbroadError =
  | 'required' // 必須の欄が空
  | 'unknownEmployee' // 社員番号の人がいない
  | 'notForeign' // 外国籍の情報がない人に、相手国の証明書
  | 'country' // 国が2文字のコードでない（日本も不可）
  | 'date' // 日付が読めない
  | 'order' // 終わりが始まりより前
  | 'covers' // 範囲が読めない
  | 'coversUnknown' // 範囲が空で、協定の一覧にない国（決められない）
  | 'payer' // 給与を払う会社が読めない
  | 'pair' // 日本の適用証明書の期間が片方だけ
  | 'overlap' // ほかの海外勤務と期間が重なる
  | 'duplicate'; // ファイルの中で同じ人が2回（証明書）・期間が重なる（海外勤務）

export interface AbroadRowError {
  column: AbroadColumn | null;
  code: AbroadError;
}

export interface AbroadImportRow {
  line: number;
  employee: AbroadTarget | null;
  errors: AbroadRowError[];
  warnings: (CertificateWarning | OverseasWarning | 'replace')[];
  /** 登録済みと同じなので飛ばす */
  skip: 'same' | null;
  certificate: CertificateDoc | null;
  overseas: Overseas | null;
}

export interface AbroadRead {
  missing: AbroadColumn[];
  rows: AbroadImportRow[];
}

/** 日付（2026-04-01・2026/4/1・R8.4.1 など）。空は ''、読めなければ undefined */
function date(s: string): string | undefined {
  const t = s.trim();
  if (t === '') return '';
  const d = readDate(t);
  return d && DATE_RE.test(d) ? d : undefined;
}

export function planAbroadImport(
  kind: AbroadKind,
  table: readonly (readonly string[])[],
  targets: readonly AbroadTarget[],
  ctx: { agreements: readonly AgreementLike[]; today: string },
): AbroadRead {
  const [header = [], ...body] = table;
  const index = indexOf(kind, header);
  const missing = REQUIRED[kind].filter((c) => index[c] === undefined);
  if (missing.length) return { missing, rows: [] };

  const byNo = new Map(
    targets.filter((t) => t.employeeNumber).map((t) => [key(t.employeeNumber!).replace(/^0+(?=\d)/, ''), t]),
  );
  const seen = new Map<string, Overseas[]>(); // 従業員ID → ファイルの中で先に出た海外勤務
  const seenCert = new Set<string>();
  const rows: AbroadImportRow[] = [];

  body.forEach((cells, i) => {
    if (isBlankRow(cells)) return;
    const line = i + 2;
    const get = (c: AbroadColumn) => (index[c] === undefined ? '' : (cells[index[c]!] ?? '').trim());
    const errors: AbroadRowError[] = [];
    const err = (column: AbroadColumn | null, code: AbroadError) => errors.push({ column, code });
    const row: AbroadImportRow = { line, employee: null, errors, warnings: [], skip: null, certificate: null, overseas: null };
    rows.push(row);

    for (const c of REQUIRED[kind]) if (!get(c)) err(c, 'required');
    const no = get('employeeNumber');
    const employee = no ? (byNo.get(key(no).replace(/^0+(?=\d)/, '')) ?? null) : null;
    row.employee = employee;
    if (no && !employee) err('employeeNumber', 'unknownEmployee');
    const country = toHalfWidth(get('country')).toUpperCase();
    if (country && (!/^[A-Z]{2}$/.test(country) || country === 'JP')) err('country', 'country');

    if (kind === 'certificate') {
      if (employee && !employee.foreign) err('employeeNumber', 'notForeign');
      const from = date(get('from'));
      const to = date(get('to'));
      if (from === undefined) err('from', 'date');
      if (to === undefined) err('to', 'date');
      if (from && to && to <= from) err('to', 'order');
      const coversText = key(get('covers'));
      let covers: AgreementCovers | null = null;
      if (coversText) {
        covers = COVERS[coversText] ?? null;
        if (!covers) err('covers', 'covers');
      } else if (country && !errors.some((e) => e.column === 'country')) {
        covers = defaultCovers(country, ctx.agreements);
        if (!covers) err('covers', 'coversUnknown');
      }
      if (employee) {
        if (seenCert.has(employee.id)) err('employeeNumber', 'duplicate');
        seenCert.add(employee.id);
      }
      if (errors.length || !employee || !from || !covers) return;
      const cert: CertificateDoc = { country, from, to: to || null, covers };
      const before = employee.certificate;
      if (before && before.country === cert.country && before.from === cert.from && before.to === cert.to && before.covers === cert.covers) {
        row.skip = 'same';
        return;
      }
      row.certificate = cert;
      row.warnings = [...(before ? (['replace'] as const) : []), ...certificateWarnings(cert, ctx.agreements, ctx.today)];
      return;
    }

    // ----- 海外勤務 -----
    const payerText = key(get('payer'));
    const payer = payerText ? (PAYER[payerText] ?? null) : 'japan';
    if (!payer) err('payer', 'payer');
    const dates: Record<'from' | 'to' | 'certificateFrom' | 'certificateTo', string | undefined> = {
      from: date(get('from')),
      to: date(get('to')),
      certificateFrom: date(get('certificateFrom')),
      certificateTo: date(get('certificateTo')),
    };
    for (const [c, v] of Object.entries(dates)) if (v === undefined) err(c as AbroadColumn, 'date');
    if (errors.length || !employee || !payer) return;
    const form: OverseasFormValue = {
      country,
      from: dates.from!,
      to: dates.to!,
      payer,
      certificateFrom: dates.certificateFrom!,
      certificateTo: dates.certificateTo!,
      note: get('note'),
    };
    const formErrors = overseasErrors(form);
    for (const [c, code] of Object.entries(formErrors)) err(c as AbroadColumn, code as AbroadError);
    if (errors.length) return;
    const o = fromOverseasForm(form)!;
    const same = employee.overseas.find((x) => x.country === o.country && x.from === o.from);
    if (same) {
      row.skip = 'same';
      return;
    }
    if (overseasOverlaps(o, employee.overseas)) {
      err('from', 'overlap');
      return;
    }
    const earlier = seen.get(employee.id) ?? [];
    if (overseasOverlaps(o, earlier)) {
      err('from', 'duplicate');
      return;
    }
    seen.set(employee.id, [...earlier, o]);
    row.overseas = o;
    row.warnings = overseasWarnings({
      item: o,
      agreements: ctx.agreements,
      careAge: { from: ageReachDate(employee.birthDate, 40), to: ageReachDate(employee.birthDate, 65) },
      careExemptions: employee.careExemptions.filter((c) => c.reason === 'overseas'),
    });
  });
  return { missing, rows };
}

/** ひな形（見出し ＋ 例1行） */
export function abroadCsvTemplate(kind: AbroadKind): string[][] {
  if (kind === 'certificate') {
    return [
      Object.values(CERTIFICATE_CSV_HEADERS),
      ['E007', '', 'DE', '年金と医療', '2026-04-01', '2031-03-31'],
    ];
  }
  return [
    Object.values(OVERSEAS_CSV_HEADERS),
    ['E030', '', 'US', '2026-10-01', '2029-09-30', '日本と海外の会社の両方', '2026-10-01', '2029-09-30', 'ロサンゼルス支店'],
  ];
}

/** その列の見出しになりうる言葉（その場で直すとき、ファイルの見出しから列を探す） */
export function abroadLabels(kind: AbroadKind, column: string): string[] {
  const h = abroadHeaders(kind)[column];
  return h ? [h, ...(WORDS[column as AbroadColumn] ?? [])] : [column];
}

/** その場で直す欄（エラーに関係する列） */
export function abroadFixColumns(errors: readonly AbroadRowError[]): AbroadColumn[] {
  return [...new Set(errors.map((e) => e.column).filter((c): c is AbroadColumn => !!c))];
}
