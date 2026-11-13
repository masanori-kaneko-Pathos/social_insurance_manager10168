/**
 * 従業員の名前の並べ方と検索（iPhone の連絡先と同じ：あ〜わ → A〜Z → #）
 * Angular・Firebase に依存しない純粋な関数
 */
import { EmployeeDoc } from '../../../core/models/employee';
import { toHalfWidth, toKatakana } from '../../../shared/utils/text';

export type NamedEmployee = Pick<
  EmployeeDoc,
  'employeeNumber' | 'lastName' | 'firstName' | 'lastNameKana' | 'firstNameKana' | 'nameOrder' | 'foreign'
>;

/** ローマ字の列を「姓」と「名」のどちらで並べるか */
export type RomanBy = 'last' | 'first';

export interface NameSection<T> {
  label: string; // 'あ'〜'わ'・'A'〜'Z'・'#'
  items: T[];
}

const KANA_ROWS: [string, string][] = [
  ['あ', 'アイウエオ'],
  ['か', 'カキクケコ'],
  ['さ', 'サシスセソ'],
  ['た', 'タチツテト'],
  ['な', 'ナニヌネノ'],
  ['は', 'ハヒフヘホ'],
  ['ま', 'マミムメモ'],
  ['や', 'ヤユヨ'],
  ['ら', 'ラリルレロ'],
  ['わ', 'ワヰヱヲン'],
];
const SMALL = 'ァィゥェォッャュョヮヵヶ';
const LARGE = 'アイウエオツヤユヨワカケ';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** 見出しの順番 */
export const SECTION_ORDER = [...KANA_ROWS.map(([l]) => l), ...ALPHABET, '#'];

/** カナ1文字 → 行の見出し（ガ → か、ャ → や、ヴ → あ）。カナでなければ null */
export function kanaRow(ch: string): string | null {
  let c = toKatakana(ch).normalize('NFD')[0] ?? ''; // 濁点・半濁点を外す
  const i = SMALL.indexOf(c);
  if (i >= 0) c = LARGE[i];
  for (const [label, chars] of KANA_ROWS) if (chars.includes(c)) return label;
  return null;
}

/** 外国籍でローマ字の列に並ぶ人か（ローマ字がなければカナの列に戻す） */
function usesRoman(e: NamedEmployee): boolean {
  return e.nameOrder === 'roman' && !!e.foreign?.romanLastName;
}

/** 並べるための「見出し」と「並べる文字」 */
export function sortKeyOf(e: NamedEmployee, by: RomanBy = 'last'): { label: string; key: string } {
  if (usesRoman(e)) {
    const f = e.foreign!;
    const last = f.romanLastName ?? '';
    const first = [f.romanFirstName, f.romanMiddleName].filter(Boolean).join(' ');
    const key = (by === 'first' && first ? `${first} ${last}` : `${last} ${first}`).trim().toUpperCase();
    const head = key[0] ?? '';
    return { label: ALPHABET.includes(head) ? head : '#', key };
  }
  const key = toKatakana(`${e.lastNameKana} ${e.firstNameKana}`).trim();
  return { label: kanaRow(key[0] ?? '') ?? '#', key };
}

/**
 * 部署の並べる文字（11/13）：氏名と同じく あ〜わ → A〜Z → その他 の順
 * - 読みがあれば読みで（漢字の部署名も あいうえお順 に並ぶ）
 * - 読みがなければ名前の1文字目で：カナ・ひらがな → あ〜わ、英字 → A〜Z、漢字など → 最後
 * 返す文字の先頭の数字（0・1・2）がまとまりの順番
 */
export function deptSortKey(name: string, kana?: string | null): string {
  const k = toKatakana((kana ?? '').normalize('NFKC').trim());
  if (k && kanaRow(k[0])) return `0${k}`;
  const n = toHalfWidth(name.normalize('NFKC').trim());
  const head = (n[0] ?? '').toUpperCase();
  if (ALPHABET.includes(head)) return `1${n.toUpperCase()}`;
  if (kanaRow(n[0] ?? '')) return `0${toKatakana(n)}`;
  return `2${n}`;
}

/** 見出しごとにまとめて並べる（空の見出しは出さない） */
export function groupByName<T extends NamedEmployee>(list: T[], by: RomanBy = 'last'): NameSection<T>[] {
  const keyed = list.map((e) => ({ e, ...sortKeyOf(e, by) }));
  const sections: NameSection<T>[] = [];
  for (const label of SECTION_ORDER) {
    const items = keyed
      .filter((k) => k.label === label)
      .sort((a, b) => a.key.localeCompare(b.key, 'ja'))
      .map((k) => k.e);
    if (items.length) sections.push({ label, items });
  }
  return sections;
}

/** 検索用に文字をそろえる（全角→半角・大文字・ひらがな→カタカナ・空白と「・」を取る） */
export function normalizeForSearch(s: string): string {
  return toKatakana(toHalfWidth(s)).toUpperCase().replace(/[\s・･]/g, '');
}

/** 漢字・カナ・ローマ字（姓名どちらの順でも）・住民票の漢字氏名・通称・社員番号のどれかに当たるか */
export function matchesName(e: NamedEmployee, query: string): boolean {
  const q = normalizeForSearch(query);
  if (!q) return true;
  const f = e.foreign;
  const texts = [
    e.lastName + e.firstName,
    e.lastNameKana + e.firstNameKana,
    e.employeeNumber ?? '',
  ];
  if (f) {
    const last = f.romanLastName ?? '';
    const first = [f.romanFirstName, f.romanMiddleName].filter(Boolean).join('');
    texts.push(last + first, first + last);
    for (const n of [f.kanjiName, f.alias]) {
      if (n) texts.push(n.last + n.first, n.lastKana + n.firstKana);
    }
  }
  return texts.some((t) => normalizeForSearch(t).includes(q));
}
