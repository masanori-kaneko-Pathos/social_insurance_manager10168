// 給与ソフトとの役割分担（11/11）
// - 天引き（控除額）の計算は給与ソフトがする。このアプリは等級・料率・届出の正本を持つ
// - アプリ → 給与ソフト：標準報酬月額・介護の有無・本人負担の目安を渡す（softwareExportRows）
// - 給与ソフト → アプリ：控除額を取り込み、アプリの本人負担と突き合わせる（compareDeductions）
// Angular・Firebase に依存しない純粋な関数

import type { ImportField, OurTableSpec } from '../../../shared/import/column-map';

// ===== アプリ → 給与ソフト =====

export interface SoftwareRow {
  employeeNumber: string | null;
  name: string;
  healthStandard: number | null;
  pensionStandard: number | null;
  care: boolean;
  healthEmployeeYen: number; // 本人負担 健保等（介護・支援金を含む）
  pensionEmployeeYen: number | null;
}

export const SOFTWARE_HEADER = [
  '社員番号', '氏名', '対象月', '控除する給与の月', '健保 標準報酬月額', '厚年 標準報酬月額', '介護保険（1＝あり）',
  '本人負担 健保等', '本人負担 厚年', '本人負担 合計',
] as const;

export function softwareExportRows(rows: readonly SoftwareRow[], month: string, payMonth: string): string[][] {
  return [
    [...SOFTWARE_HEADER],
    ...rows.map((r) => [
      r.employeeNumber ?? '',
      r.name,
      month,
      payMonth,
      r.healthStandard == null ? '' : String(r.healthStandard),
      r.pensionStandard == null ? '' : String(r.pensionStandard),
      r.care ? '1' : '0',
      String(r.healthEmployeeYen),
      r.pensionEmployeeYen == null ? '' : String(r.pensionEmployeeYen),
      String(r.healthEmployeeYen + (r.pensionEmployeeYen ?? 0)),
    ]),
  ];
}

// ===== 給与ソフト → アプリ（控除額の取り込み） =====

export type DeductionKey = 'employeeNumber' | 'name' | 'health' | 'care' | 'pension' | 'total';
export const DEDUCTION_KEYS: readonly DeductionKey[] = ['employeeNumber', 'name', 'health', 'care', 'pension', 'total'];

const HEADERS: Record<DeductionKey, string> = {
  employeeNumber: '社員番号',
  name: '氏名',
  health: '健康保険料',
  care: '介護保険料',
  pension: '厚生年金保険料',
  total: '社会保険料の合計',
};

/** 列の対応づけ（どの給与ソフトの列名でも合わせられるよう、言い換えを広めに） */
export const DEDUCTION_FIELDS: readonly ImportField<DeductionKey>[] = [
  {
    key: 'employeeNumber',
    header: HEADERS.employeeNumber,
    words: ['従業員番号', '従業員コード', '社員コード', '社員No', '職員番号', 'Employee number'],
    required: true,
    orFrom: ['name'],
  },
  { key: 'name', header: HEADERS.name, words: ['従業員名', '社員名', '姓名', 'Name'] },
  {
    key: 'health',
    header: HEADERS.health,
    words: ['健康保険', '健保', '健康保険料控除', '健保料', 'Health insurance'],
    kind: 'number',
    required: true,
    orFrom: ['total'],
  },
  { key: 'care', header: HEADERS.care, words: ['介護保険', '介護', '介護保険料控除', 'Care insurance'], kind: 'number' },
  {
    key: 'pension',
    header: HEADERS.pension,
    words: ['厚生年金', '厚年', '厚生年金保険', '厚生年金控除', 'Pension'],
    kind: 'number',
    required: true,
    orFrom: ['total'],
  },
  { key: 'total', header: HEADERS.total, words: ['社会保険料計', '社会保険料', '社保計', '社会保険料合計'], kind: 'number' },
];

export const DEDUCTION_TABLE_SPEC: OurTableSpec<DeductionKey, DeductionKey> = {
  fields: DEDUCTION_FIELDS,
  out: DEDUCTION_KEYS,
  outHeader: (k) => HEADERS[k],
};

export interface AppDeduction {
  id: string;
  employeeNumber: string | null;
  lastName: string;
  firstName: string;
  healthEmployeeYen: number;
  pensionEmployeeYen: number;
}

export type CompareStatus = 'match' | 'diff' | 'notInApp' | 'ambiguous' | 'notInFile';

export interface CompareRow {
  label: string; // ファイルの社員番号か氏名
  employee: AppDeduction | null;
  app: { health: number; pension: number } | null;
  soft: { health: number | null; pension: number | null; total: number | null } | null;
  /** 給与ソフト − アプリ（比べられないときは null） */
  diff: number | null;
  status: CompareStatus;
}

const num = (s: string | undefined) => (s && s.trim() !== '' && !Number.isNaN(Number(s)) ? Number(s) : null);
const nameKey = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
const noKey = (s: string) => s.normalize('NFKC').trim().replace(/^0+(?=\d)/, '');

/**
 * 取り込んだ控除額（うちの見出しの表）とアプリの本人負担を比べる
 * - 健保等は「健康保険料 ＋ 介護保険料」（アプリの健保等は介護・支援金を含むため）
 * - 健保・厚年が分かれていなければ、合計で比べる
 * - 照合：社員番号（先頭の0は無視）→ なければ氏名（同じ氏名が2人なら ambiguous）
 * - アプリで計算できた人のうち、ファイルにいない人は notInFile として最後に並べる
 */
export function compareDeductions(table: readonly (readonly string[])[], app: readonly AppDeduction[]): CompareRow[] {
  const [head, ...rows] = table;
  const col = (k: DeductionKey) => head.indexOf(HEADERS[k]);
  const byNo = new Map<string, AppDeduction>();
  const byName = new Map<string, AppDeduction[]>();
  for (const a of app) {
    if (a.employeeNumber) byNo.set(noKey(a.employeeNumber), a);
    const k = nameKey(`${a.lastName}${a.firstName}`);
    byName.set(k, [...(byName.get(k) ?? []), a]);
  }
  const seen = new Set<string>();
  const out: CompareRow[] = [];
  for (const r of rows) {
    const get = (k: DeductionKey) => (col(k) >= 0 ? (r[col(k)] ?? '') : '');
    const no = get('employeeNumber').trim();
    const name = get('name').trim();
    if (!no && !name) continue;
    const health = num(get('health'));
    const care = num(get('care'));
    const pension = num(get('pension'));
    const total = num(get('total'));
    const soft = { health: health == null ? null : health + (care ?? 0), pension, total };

    let employee: AppDeduction | null = null;
    let status: CompareStatus | null = null;
    if (no) employee = byNo.get(noKey(no)) ?? null;
    if (!employee && name) {
      const list = byName.get(nameKey(name)) ?? [];
      if (list.length === 1) employee = list[0];
      else if (list.length > 1) status = 'ambiguous';
    }
    if (!employee) {
      out.push({ label: no || name, employee: null, app: null, soft, diff: null, status: status ?? 'notInApp' });
      continue;
    }
    seen.add(employee.id);
    const appV = { health: employee.healthEmployeeYen, pension: employee.pensionEmployeeYen };
    const softTotal =
      soft.health != null && soft.pension != null ? soft.health + soft.pension : (soft.total ?? null);
    const diff = softTotal == null ? null : softTotal - (appV.health + appV.pension);
    const partMismatch =
      soft.health != null && soft.pension != null && (soft.health !== appV.health || soft.pension !== appV.pension);
    out.push({
      label: no || name,
      employee,
      app: appV,
      soft,
      diff,
      status: diff === 0 && !partMismatch ? 'match' : 'diff',
    });
  }
  for (const a of app) {
    if (seen.has(a.id)) continue;
    out.push({
      label: a.employeeNumber ?? `${a.lastName} ${a.firstName}`,
      employee: a,
      app: { health: a.healthEmployeeYen, pension: a.pensionEmployeeYen },
      soft: null,
      diff: null,
      status: 'notInFile',
    });
  }
  return out;
}
