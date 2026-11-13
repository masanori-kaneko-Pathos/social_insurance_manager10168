// 賞与の額をファイルから読み込む（11/13）
// 給与ソフトなどから書き出した「社員番号（または氏名）と賞与額」の表を、賞与の登録画面の入力欄に流し込む
// 保存はしない（画面で確かめてから「保存する」）。Angular・Firebase に依存しない純粋な関数

import type { ImportField, OurTableSpec } from '../../../shared/import/column-map';

export const BONUS_IMPORT_KEYS = ['employeeNumber', 'name', 'amount'] as const;
export type BonusImportKey = (typeof BONUS_IMPORT_KEYS)[number];

const HEADERS: Record<BonusImportKey, string> = {
  employeeNumber: '社員番号',
  name: '氏名',
  amount: '賞与額',
};

export const BONUS_IMPORT_FIELDS: readonly ImportField<BonusImportKey>[] = [
  {
    key: 'employeeNumber',
    header: HEADERS.employeeNumber,
    words: ['従業員番号', '従業員コード', '社員コード', '社員No', '職員番号', 'Employee number'],
    required: true,
    orFrom: ['name'],
  },
  { key: 'name', header: HEADERS.name, words: ['従業員名', '社員名', '姓名', '名前', 'Name'] },
  {
    key: 'amount',
    header: HEADERS.amount,
    words: ['賞与', '賞与支給額', '支給額', '賞与金額', '総支給額', 'Bonus', 'Amount'],
    kind: 'number',
    required: true,
  },
];

export const BONUS_IMPORT_SPEC: OurTableSpec<BonusImportKey, BonusImportKey> = {
  fields: BONUS_IMPORT_FIELDS,
  out: BONUS_IMPORT_KEYS,
  outHeader: (k) => HEADERS[k],
};

export interface BonusTarget {
  id: string;
  employeeNumber: string | null;
  lastName: string;
  firstName: string;
}

export interface BonusImportResult {
  /** 従業員ID → 賞与額（円） */
  amounts: Map<string, number>;
  /** 見つからなかった行（ファイルの社員番号か氏名） */
  notFound: string[];
  /** 同じ氏名の人が複数いて決められなかった行 */
  ambiguous: string[];
  /** 金額が読めなかった行 */
  badAmount: string[];
}

const nameKey = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
const noKey = (s: string) => s.normalize('NFKC').trim().replace(/^0+(?=\d)/, '');

/** 金額（「500,000」「500000円」も読む）。読めなければ null */
function yen(s: string): number | null {
  const t = s.normalize('NFKC').replace(/[,，\s円¥￥]/g, '');
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * 列を合わせたあとの表（1行目は うちの見出し）を、従業員に結ぶ
 * 社員番号で探し、なければ氏名で（同じ氏名が1人だけのとき）
 * 同じ人が2回出てきたら、あとの行で上書きする
 */
export function matchBonusRows(table: readonly (readonly string[])[], targets: readonly BonusTarget[]): BonusImportResult {
  const [head = [], ...rows] = table;
  const col = (k: BonusImportKey) => head.indexOf(HEADERS[k]);
  const byNo = new Map<string, BonusTarget>();
  const byName = new Map<string, BonusTarget[]>();
  for (const t of targets) {
    if (t.employeeNumber) byNo.set(noKey(t.employeeNumber), t);
    const k = nameKey(`${t.lastName}${t.firstName}`);
    byName.set(k, [...(byName.get(k) ?? []), t]);
  }
  const out: BonusImportResult = { amounts: new Map(), notFound: [], ambiguous: [], badAmount: [] };
  for (const r of rows) {
    const get = (k: BonusImportKey) => (col(k) >= 0 ? (r[col(k)] ?? '') : '').trim();
    const no = get('employeeNumber');
    const name = get('name');
    if (!no && !name) continue;
    const label = no || name;
    let target: BonusTarget | null = no ? (byNo.get(noKey(no)) ?? null) : null;
    if (!target && name) {
      const list = byName.get(nameKey(name)) ?? [];
      if (list.length > 1) {
        out.ambiguous.push(label);
        continue;
      }
      target = list[0] ?? null;
    }
    if (!target) {
      out.notFound.push(label);
      continue;
    }
    const amount = yen(get('amount'));
    if (amount === null) {
      out.badAmount.push(label);
      continue;
    }
    out.amounts.set(target.id, amount);
  }
  return out;
}
