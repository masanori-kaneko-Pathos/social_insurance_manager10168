// 扶養家族の取り込み（1行 ＝ 扶養家族1人。社員番号で従業員に結ぶ。11/13）
// Angular・Firebase に依存しない純粋な関数
//
// - 画面と同じ部品（emptyDependentForm → dependentErrors → fromDependentForm）を通す。画面で入れても CSV で入れても同じ結果
// - 追加だけ：同じ従業員に同じ氏名＋生年月日の人がいれば、その行は飛ばして知らせる（上書きしない）
// - 画面だけで入れる項目：海外特例・労働契約による年収の判定・続柄の確認・資格確認書・配偶者の電話

import type {
  DependentEndReason,
  DependentInput,
  DependentStartReason,
  Occupation,
  Relationship,
} from '../../../core/models/dependent';
import type { ImportField, OurTableSpec, RowValues } from '../../../shared/import/column-map';
import { splitName } from '../../../shared/import/column-map';
import { ageAt } from '../../../shared/utils/date';
import { toHalfWidth, toKatakana } from '../../../shared/utils/text';
import { limitOf } from './dependent-check';
import { DependentField, dependentErrors, emptyDependentForm, fromDependentForm } from './dependent-form-model';
import { dateErrorCode, readDate, yesNo } from './employee-csv';
import { makeNumberMatcher } from '../../../shared/import/number-match';

// ===== 列 =====

export const DEPENDENT_CSV_HEADERS = {
  employeeNumber: '社員番号',
  relationship: '続柄',
  relationshipNote: '続柄の補足', // 続柄が「その他」のとき（叔父・姪など。11/17）
  lastName: '姓',
  firstName: '名',
  lastNameKana: 'セイ',
  firstNameKana: 'メイ',
  birthDate: '生年月日',
  from: '扶養になった日',
  sex: '性別',
  livingTogether: '同居',
  annualIncome: '年収の見込み',
  occupation: '職業',
  schoolYear: '学年',
  disabled: '障害者',
  basicPensionNumber: '基礎年金番号',
  startReason: '扶養になった理由',
  to: '扶養から外れた日',
  endReason: '扶養から外れた理由',
  postalCode: '郵便番号',
  address: '住所',
  remittance: '仕送りの額',
  remittanceTimes: '仕送りの年の回数',
  nationality: '国籍',
  note: 'メモ',
} as const;

export type DependentColumn = keyof typeof DEPENDENT_CSV_HEADERS;
export const DEPENDENT_COLUMNS = Object.keys(DEPENDENT_CSV_HEADERS) as DependentColumn[];
export type DependentImportKey = DependentColumn | 'fullName' | 'fullNameKana';

const REQUIRED: readonly DependentColumn[] = ['employeeNumber', 'relationship', 'lastName', 'lastNameKana', 'birthDate', 'from'];

const WORDS: Partial<Record<DependentImportKey, readonly string[]>> = {
  employeeNumber: ['従業員番号', '従業員コード', '社員コード', '社員No', '被保険者の社員番号'],
  relationship: ['続き柄', '関係', '本人との続柄'],
  relationshipNote: ['続柄の内容', '続柄（その他）', '具体的な続柄', 'その他の続柄'],
  // 「扶養者姓・名」は扶養している側（従業員本人）のことが多いので、似た列として聞く（NEAR。11/25）
  lastName: ['被扶養者の姓', '家族の姓'],
  firstName: ['被扶養者の名', '家族の名'],
  lastNameKana: ['被扶養者のセイ', 'フリガナ（姓）'],
  firstNameKana: ['被扶養者のメイ', 'フリガナ（名）'],
  birthDate: ['被扶養者の生年月日', '家族の生年月日'],
  from: ['被扶養者になった日', '扶養開始日', '認定日', '扶養認定日'],
  livingTogether: ['同居・別居', '同居区分', '同居の有無'],
  annualIncome: ['年間収入', '年収', '収入（年額）', '年間収入の見込み'],
  occupation: ['職業区分'],
  disabled: ['障害者区分', '障害'],
  to: ['被扶養者でなくなった日', '扶養終了日', '削除日'],
  endReason: ['被扶養者でなくなった理由', '扶養終了の理由'],
  startReason: ['被扶養者になった理由', '扶養開始の理由'],
  remittance: ['送金額', '仕送り額'],
  remittanceTimes: ['送金回数', '仕送り回数'],
  note: ['備考'],
};

/** 似ているけれど意味が違うことがある見出し（11/25） */
const NEAR: Partial<Record<DependentImportKey, ImportField['near']>> = {
  lastName: [{ words: ['扶養者姓'], noteKey: 'dependentCsv.near.supporter' }],
  firstName: [{ words: ['扶養者名'], noteKey: 'dependentCsv.near.supporter' }],
};

const KIND: Partial<Record<DependentImportKey, 'date' | 'number' | 'digits' | 'kana'>> = {
  birthDate: 'date', from: 'date', to: 'date',
  annualIncome: 'number', remittance: 'number', remittanceTimes: 'number', schoolYear: 'number',
  basicPensionNumber: 'digits', postalCode: 'digits',
  lastNameKana: 'kana', firstNameKana: 'kana', fullNameKana: 'kana',
};

const ORDER: readonly DependentImportKey[] = [
  ...DEPENDENT_COLUMNS.slice(0, 4), 'fullName', DEPENDENT_COLUMNS[4], DEPENDENT_COLUMNS[5], 'fullNameKana', ...DEPENDENT_COLUMNS.slice(6),
];

const EXTRA_HEADERS: Record<'fullName' | 'fullNameKana', string> = {
  fullName: '氏名（姓と名が1つの列）',
  fullNameKana: 'フリガナ（セイとメイが1つの列）',
};

export const DEPENDENT_IMPORT_FIELDS: readonly ImportField<DependentImportKey>[] = ORDER.map((key) => ({
  key,
  header: key === 'fullName' || key === 'fullNameKana' ? EXTRA_HEADERS[key] : DEPENDENT_CSV_HEADERS[key],
  words: WORDS[key] ?? [],
  kind: KIND[key],
  required: (REQUIRED as readonly string[]).includes(key),
  orFrom: key === 'lastName' ? ['fullName'] : key === 'lastNameKana' ? ['fullNameKana'] : undefined,
  near: NEAR[key],
}));

export const DEPENDENT_TABLE_SPEC: OurTableSpec<DependentImportKey, DependentColumn> = {
  fields: DEPENDENT_IMPORT_FIELDS,
  out: DEPENDENT_COLUMNS,
  outHeader: (c) => DEPENDENT_CSV_HEADERS[c],
  finish: (v: RowValues<DependentImportKey>) => {
    const out = { ...v };
    if (!out.lastName && !out.firstName && out.fullName) [out.lastName, out.firstName] = splitName(out.fullName);
    if (!out.lastNameKana && !out.firstNameKana && out.fullNameKana) {
      [out.lastNameKana, out.firstNameKana] = splitName(out.fullNameKana);
    }
    return out;
  },
};

/** ひな形（見出し ＋ 例2行） */
export function dependentCsvTemplate(): string[][] {
  const row = (x: Partial<Record<DependentColumn, string>>) => DEPENDENT_COLUMNS.map((c) => x[c] ?? '');
  return [
    DEPENDENT_COLUMNS.map((c) => DEPENDENT_CSV_HEADERS[c]),
    row({ employeeNumber: 'E001', relationship: '妻', lastName: '山田', firstName: '花子', lastNameKana: 'ヤマダ', firstNameKana: 'ハナコ',
      birthDate: '1991-02-03', from: '2026-04-01', sex: '女', livingTogether: 'はい', annualIncome: '0', occupation: '無職' }),
    row({ employeeNumber: 'E001', relationship: '長男', lastName: '山田', firstName: '一郎', lastNameKana: 'ヤマダ', firstNameKana: 'イチロウ',
      birthDate: '2020-06-10', from: '2026-04-01', sex: '男', startReason: '出生' }),
    // 11/27：例を増やした（パートの配偶者・学生の子・別居の親）
    row({ employeeNumber: 'E003', relationship: '夫', lastName: '鈴木', firstName: '誠', lastNameKana: 'スズキ', firstNameKana: 'マコト',
      birthDate: '1984-04-04', from: '2026-04-01', sex: '男', livingTogether: 'はい', annualIncome: '900000', occupation: 'パート' }),
    row({ employeeNumber: 'E003', relationship: '長女', lastName: '鈴木', firstName: '結衣', lastNameKana: 'スズキ', firstNameKana: 'ユイ',
      birthDate: '2008-08-08', from: '2026-04-01', sex: '女', occupation: '高校生' }),
    row({ employeeNumber: 'E007', relationship: '母', lastName: '伊藤', firstName: '紀子', lastNameKana: 'イトウ', firstNameKana: 'ノリコ',
      birthDate: '1958-01-10', from: '2026-04-01', sex: '女', livingTogether: 'いいえ', annualIncome: '1200000', occupation: '年金受給者' }),
  ];
}

// ===== 値の読み方（言葉で書いても読む） =====

const REL: Record<string, Relationship> = {
  妻: 'spouse', 夫: 'spouse', 配偶者: 'spouse', 内縁: 'spouse', spouse: 'spouse',
  子: 'child', 長男: 'child', 長女: 'child', 次男: 'child', 次女: 'child', 二男: 'child', 二女: 'child', 三男: 'child', 三女: 'child',
  実子: 'child', 養子: 'child', 子ども: 'child', 子供: 'child', child: 'child',
  連れ子: 'otherChild', 配偶者の子: 'otherChild',
  父: 'parent', 母: 'parent', 父母: 'parent', 養父: 'parent', 養母: 'parent', 実父: 'parent', 実母: 'parent', parent: 'parent',
  義父: 'parentInLaw', 義母: 'parentInLaw', 配偶者の父: 'parentInLaw', 配偶者の母: 'parentInLaw',
  弟: 'youngerSibling', 妹: 'youngerSibling', 兄: 'olderSibling', 姉: 'olderSibling',
  祖父: 'grandparent', 祖母: 'grandparent', 祖父母: 'grandparent', 曽祖父: 'greatGrandparent', 曽祖母: 'greatGrandparent',
  孫: 'grandchild', その他: 'other', other: 'other',
  // 画面の名前のまとめ方でも読む（取り込みの窓のプルダウンから入る言葉。11/17）
  義父母: 'parentInLaw', 弟妹: 'youngerSibling', 兄姉: 'olderSibling', 曽祖父母: 'greatGrandparent',
};
/** 「その他」に入れて、言葉を続柄の補足に残すもの（3親等内の親族） */
const REL_OTHER = ['伯父', '叔父', '伯母', '叔母', 'おじ', 'おば', '甥', '姪', 'おい', 'めい', 'ひ孫', '曾孫'];

const OCC: Record<string, Occupation> = {
  無職: 'none', なし: 'none', 専業主婦: 'none', 専業主夫: 'none',
  パート: 'partTime', アルバイト: 'partTime', 'パート・アルバイト': 'partTime',
  年金受給者: 'pensioner', 年金: 'pensioner',
  小中学生以下: 'child', 未就学児: 'child', 未就学: 'child', 小学生: 'child', 中学生: 'child', 乳幼児: 'child',
  高校生: 'student', 大学生: 'student', 高大学生: 'student', '高・大学生': 'student', 専門学生: 'student', 学生: 'student',
  その他: 'other',
};

const START: Record<string, DependentStartReason> = {
  被保険者の就職: 'spouseEmployment', 入社: 'spouseEmployment', 婚姻: 'marriage', 結婚: 'marriage',
  離職: 'leftJob', 退職: 'leftJob', 収入減少: 'incomeDecrease', 収入の減少: 'incomeDecrease',
  出生: 'birth', 誕生: 'birth', 同居: 'cohabitation', その他: 'other',
};

const END: Record<string, DependentEndReason> = {
  死亡: 'death', 離婚: 'divorce', 就職: 'employment', 収入増加: 'incomeIncrease', 収入の増加: 'incomeIncrease',
  '75歳到達': 'age75', 後期高齢者: 'age75', 障害認定: 'disability', その他: 'other',
};

const SEX: Record<string, 'male' | 'female'> = { 男: 'male', 男性: 'male', '1': 'male', 女: 'female', 女性: 'female', '2': 'female' };

const key = (s: string) => toHalfWidth(s).normalize('NFKC').trim();

// ===== 1行を読む → 結ぶ → 確かめる =====

export interface DependentTarget {
  id: string;
  employeeNumber: string | null;
  lastName: string;
  firstName: string;
  hireDate: string;
}

export type DependentRowError =
  | 'employeeNotFound'
  | 'ambiguousEmployee' // 先頭の0を落とすと2人に当たる（0012 と 12 など。11/28）
  | 'relationship'
  | 'occupation'
  | 'startReason'
  | 'endReason'
  | 'sex'
  | 'yesNo'
  | 'date'
  | 'noSuchDate'
  | `field.${DependentField}.${string}`;

export type DependentRowWarning = 'noIncome' | 'overLimit' | 'beforeHire' | 'age75' | 'spouseTwice' | 'zeroPadded';

/** 配偶者の扶養の期間（重なりを見る。to は空なら今も続いている） */
export interface SpousePeriod {
  from: string;
  to: string | null;
}

export interface DependentImportRow {
  line: number;
  employee: DependentTarget | null;
  name: string;
  relationship: Relationship | null;
  /** 取り込む中身（エラーか飛ばすなら null） */
  input: DependentInput | null;
  errors: DependentRowError[];
  warnings: DependentRowWarning[];
  /** 登録済み（同じ氏名＋生年月日）・ファイルの中で重なった → 飛ばす */
  skip: 'exists' | 'duplicateInFile' | null;
}

/** 同じ人かどうかを見る鍵（氏名＋生年月日） */
export function personKey(lastName: string, firstName: string, birthDate: string): string {
  return `${key(lastName)}${key(firstName)}|${birthDate}`.replace(/\s+/g, '');
}

/**
 * 列を合わせたあとの表（1行目は うちの見出し）を読む
 * existing：従業員ID → 登録済みの扶養家族の鍵（personKey）
 */
export function planDependentImport(
  table: readonly (readonly string[])[],
  targets: readonly DependentTarget[],
  existing: ReadonlyMap<string, ReadonlySet<string>>,
  today: string,
  existingSpouses: ReadonlyMap<string, readonly SpousePeriod[]> = new Map(),
): DependentImportRow[] {
  const [head = [], ...rows] = table;
  const col = (c: DependentColumn) => head.indexOf(DEPENDENT_CSV_HEADERS[c]);
  const matchNo = makeNumberMatcher(targets, (t) => t.employeeNumber);
  const seen = new Set<string>();
  const out: DependentImportRow[] = [];

  rows.forEach((r, i) => {
    const get = (c: DependentColumn) => (col(c) >= 0 ? (r[col(c)] ?? '') : '').trim();
    if (DEPENDENT_COLUMNS.every((c) => !get(c))) return; // 空の行
    const errors: DependentRowError[] = [];
    const warnings: DependentRowWarning[] = [];
    const m = matchNo(get('employeeNumber'));
    const employee = m.kind === 'ok' ? m.item : null;
    if (m.kind === 'none') errors.push('employeeNotFound');
    else if (m.kind === 'ambiguous') errors.push('ambiguousEmployee');
    else if (m.zeroPadded) warnings.push('zeroPadded');

    // 続柄
    const relWord = key(get('relationship'));
    let relationship: Relationship | null = REL[relWord] ?? null;
    // 「その他」の補足：補足の列か、続柄の列に書いた言葉（叔父・姪など）
    let relationshipNote = get('relationshipNote');
    if (!relationship && REL_OTHER.some((w) => relWord.includes(w))) {
      relationship = 'other';
      relationshipNote = relationshipNote || relWord;
    }
    if (!relationship) errors.push('relationship');

    const v = emptyDependentForm('');
    v.relationship = relationship ?? 'spouse';
    v.relationshipNote = relationshipNote;
    v.commonLaw = relWord === '内縁';
    v.lastName = get('lastName');
    v.firstName = get('firstName');
    v.lastNameKana = toKatakana(get('lastNameKana'));
    v.firstNameKana = toKatakana(get('firstNameKana'));

    const birth = readDate(get('birthDate'));
    const from = readDate(get('from'));
    const to = readDate(get('to'));
    // 形は読めるがその日がない（2026/02/30）は、形の知らせと分ける（11/28）
    const badDates = (['birthDate', 'from', 'to'] as const).filter((_, i) => [birth, from, to][i] === undefined);
    for (const code of new Set(badDates.map((c) => dateErrorCode(get(c))))) errors.push(code);
    v.birthDate = birth || '';
    v.from = from || '';
    v.to = to || '';

    const sexWord = key(get('sex'));
    if (sexWord && !SEX[sexWord]) errors.push('sex');
    v.sex = SEX[sexWord] ?? '';

    const together = yesNo(get('livingTogether').replace('同居', 'はい').replace('別居', 'いいえ'));
    const disabled = yesNo(get('disabled'));
    if (together === undefined || disabled === undefined) errors.push('yesNo');
    v.livingTogether = together ?? true;
    v.disabled = disabled ?? false;

    // 年収：空なら 0 円（本当に 0 円のこともある）。ただし確認の画面で知らせる
    const income = get('annualIncome');
    v.annualIncome = income ? toHalfWidth(income).replace(/[,，円\s]/g, '') : '0';
    if (!income) warnings.push('noIncome');

    // 職業：空なら年齢から（15歳以下 → 小中学生以下、それ以外 → 無職）
    const occWord = key(get('occupation'));
    if (occWord) {
      const o = OCC[occWord];
      if (!o) errors.push('occupation');
      v.occupation = o ?? 'none';
    } else if (birth) {
      v.occupation = ageAt(birth, from || today) <= 15 ? 'child' : 'none';
    }
    v.schoolYear = get('schoolYear');

    v.basicPensionNumber = get('basicPensionNumber');
    const sr = key(get('startReason'));
    if (sr) {
      if (!START[sr]) errors.push('startReason');
      v.startReason = START[sr] ?? '';
    }
    const er = key(get('endReason'));
    if (er) {
      if (!END[er]) errors.push('endReason');
      v.endReason = END[er] ?? '';
    }
    v.postalCode = get('postalCode');
    v.address = get('address');
    v.remittance = get('remittance');
    v.remittanceTimes = get('remittanceTimes') || '12';
    v.nationality = toHalfWidth(get('nationality')).toUpperCase();
    v.note = get('note');

    // 画面と同じチェック
    for (const [field, code] of Object.entries(dependentErrors(v))) errors.push(`field.${field}.${code}` as DependentRowError);

    const input = errors.length === 0 ? fromDependentForm(v) : null;
    const name = `${v.lastName} ${v.firstName}`.trim();

    // 重なり（登録済み・ファイルの中）
    let skip: DependentImportRow['skip'] = null;
    if (employee && birth) {
      const k = `${employee.id}#${personKey(v.lastName, v.firstName, birth)}`;
      if (existing.get(employee.id)?.has(personKey(v.lastName, v.firstName, birth))) skip = 'exists';
      else if (seen.has(k)) skip = 'duplicateInFile';
      seen.add(k);
    }

    // 注意（取り込みは止めない）
    if (input) {
      const date = input.to && input.to < today ? input.to : today;
      if (input.annualIncome >= limitOf(input, date).limit) warnings.push('overLimit');
      if (employee && input.from < employee.hireDate) warnings.push('beforeHire');
      if (ageAt(input.birthDate, today) >= 75 && !input.to) warnings.push('age75');
    }

    out.push({ line: i + 2, employee, name, relationship, input: skip ? null : input, errors, warnings, skip });
  });
  markSpouseTwice(out, existingSpouses);
  return out;
}

/** 期間が重なるか（to は空なら今も続いている。to の日はもう扶養でない） */
function overlaps(a: SpousePeriod, b: SpousePeriod): boolean {
  return (!a.to || b.from < a.to) && (!b.to || a.from < b.to);
}

/**
 * 同じ従業員に、扶養の期間が重なる配偶者が2人以上 → spouseTwice（11/24）
 * 登録済みの配偶者とファイルの配偶者を合わせて見る。離婚・死別のあとの再婚（期間が重ならない）は出さない
 */
function markSpouseTwice(rows: DependentImportRow[], existingSpouses: ReadonlyMap<string, readonly SpousePeriod[]>): void {
  const inFile = rows.filter((r) => r.employee && r.input && r.input.relationship === 'spouse');
  for (const r of inFile) {
    const me: SpousePeriod = { from: r.input!.from, to: r.input!.to };
    const others = [
      ...(existingSpouses.get(r.employee!.id) ?? []),
      ...inFile.filter((o) => o !== r && o.employee!.id === r.employee!.id).map((o) => ({ from: o.input!.from, to: o.input!.to })),
    ];
    if (others.some((o) => overlaps(me, o))) r.warnings.push('spouseTwice');
  }
}

/** エラーのコード → 画面で直す欄（11/16。取り込み画面の「その場で直す」） */
const DEPENDENT_FIX: Readonly<Record<string, readonly DependentColumn[]>> = {
  employeeNotFound: ['employeeNumber'],
  ambiguousEmployee: ['employeeNumber'],
  relationship: ['relationship'],
  date: ['birthDate', 'from', 'to'],
  noSuchDate: ['birthDate', 'from', 'to'],
  sex: ['sex'],
  yesNo: ['livingTogether', 'disabled'],
  occupation: ['occupation'],
  startReason: ['startReason'],
  endReason: ['endReason'],
};

export function dependentFixColumns(codes: readonly string[]): DependentColumn[] {
  const out: DependentColumn[] = [];
  for (const c of codes) {
    // 続柄の補足は、続柄と並べて出す（「その他」を選び直すこともあるため。11/17）
    const field = c.startsWith('field.') ? c.split('.')[1] : null;
    const cols: readonly string[] = field
      ? field === 'relationshipNote'
        ? ['relationship', 'relationshipNote']
        : [field]
      : (DEPENDENT_FIX[c] ?? []);
    for (const col of cols) {
      if ((DEPENDENT_COLUMNS as readonly string[]).includes(col) && !out.includes(col as DependentColumn)) {
        out.push(col as DependentColumn);
      }
    }
  }
  return out;
}
