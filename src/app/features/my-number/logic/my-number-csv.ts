// マイナンバーの書き出し（CSV の表）。Angular・Firebase に依存しない純粋な関数
// 書き出し：社員番号・姓・名・マイナンバー
// 取り込み（登録済みの従業員へ）：社員番号とマイナンバーの列があればよい（書き出したファイルをそのまま読める）

import { isValidMyNumber, normalizeMyNumber } from './my-number';

export const MY_NUMBER_CSV_HEADER = ['社員番号', '姓', '名', 'マイナンバー'] as const;

interface Person {
  id: string;
  employeeNumber: string | null;
  lastName: string;
  firstName: string;
}

/** 社員番号の順（なければ氏名の順）。従業員が見つからない番号は書き出さない */
export function myNumberCsv(rows: readonly { employeeId: string; number: string }[], people: readonly Person[]): string[][] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const body = rows
    .flatMap((r) => {
      const p = byId.get(r.employeeId);
      return p ? [[p.employeeNumber ?? '', p.lastName, p.firstName, r.number]] : [];
    })
    .sort((a, b) => a[0].localeCompare(b[0], 'ja', { numeric: true }) || `${a[1]}${a[2]}`.localeCompare(`${b[1]}${b[2]}`, 'ja'));
  return [[...MY_NUMBER_CSV_HEADER], ...body];
}

// ===== 取り込み（登録済みの従業員に番号を入れる） =====


const NO_WORDS = ['社員番号', '従業員番号', '従業員コード', '社員コード', '社員no', 'employeenumber', 'employeeid'];
const NUMBER_WORDS = ['マイナンバー', '個人番号', 'マイナンバー(個人番号)', '個人番号(マイナンバー)', 'mynumber', 'individualnumber'];
const key = (s: string) => s.replace(/^\uFEFF/, '').normalize('NFKC').replace(/[\s　]/g, '').toLowerCase();

export interface MyNumberImportRead {
  /** 見つからなかった列（'employeeNumber' | 'myNumber'） */
  missing: ('employeeNumber' | 'myNumber')[];
  items: { line: number; employeeId: string; number: string }[];
  errors: { line: number; code: 'notFound' | 'invalid' | 'duplicate'; label: string }[];
}

/** 1行目が見出し。社員番号で従業員を探す（先頭の0は無視）。番号が空の行は飛ばす */
export function readMyNumberTable(table: readonly (readonly string[])[], people: readonly Person[]): MyNumberImportRead {
  const [head = [], ...rows] = table;
  const keys = head.map(key);
  const noCol = keys.findIndex((h) => NO_WORDS.map(key).includes(h));
  const numCol = keys.findIndex((h) => NUMBER_WORDS.map(key).includes(h));
  const missing: MyNumberImportRead['missing'] = [];
  if (noCol < 0) missing.push('employeeNumber');
  if (numCol < 0) missing.push('myNumber');
  if (missing.length) return { missing, items: [], errors: [] };

  const noKey = (s: string) => s.normalize('NFKC').trim().replace(/^0+(?=\d)/, '');
  const byNo = new Map(people.filter((p) => p.employeeNumber).map((p) => [noKey(p.employeeNumber!), p]));
  const seen = new Set<string>();
  const out: MyNumberImportRead = { missing, items: [], errors: [] };
  rows.forEach((r, i) => {
    const line = i + 2;
    const no = (r[noCol] ?? '').trim();
    const n = normalizeMyNumber(r[numCol] ?? '');
    if (!no && !n) return;
    if (!n) return;
    const p = byNo.get(noKey(no));
    if (!p) return void out.errors.push({ line, code: 'notFound', label: no });
    if (!isValidMyNumber(n)) return void out.errors.push({ line, code: 'invalid', label: no });
    if (seen.has(p.id)) return void out.errors.push({ line, code: 'duplicate', label: no });
    seen.add(p.id);
    out.items.push({ line, employeeId: p.id, number: n });
  });
  return out;
}
