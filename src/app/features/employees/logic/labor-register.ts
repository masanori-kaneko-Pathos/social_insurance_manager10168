// 労働者名簿の法定項目をそろえるための部品（労働基準法107条・施行規則53条・様式第19号。11/24）
// Angular・Firebase に依存しない純粋な関数
//
// アプリの出力は「労働者名簿の項目を持つ従業員データの一覧」で、法定の様式そのものではない。
// 画面では「労働者名簿」と呼ばず「従業員データ」と書く（性質が違うものを名簿と言い切らないため。11/24）
//
// 名簿の項目：氏名・生年月日・履歴・性別・住所・従事する業務の種類・雇入の年月日・
//            退職の年月日と事由（解雇ならその理由を含む）・死亡の年月日と原因
// - 常時30人未満の事業では、業務の種類は書かなくてよい（53条2項）
// - 労働者でない役員は載せない（使用人を兼ねる役員は労働者なので載せる）
// - 保存は退職・死亡の日から5年（労基法109条。当分は3年＝143条）。このアプリは本則の5年で数える

import type { ContactDoc, EmployeeOrg, RegisterDoc, RegisterLine, RetireReason } from '../../../core/models/employee';
import { toHalfWidth } from '../../../shared/utils/text';

export const REGISTER_KEEP_YEARS = 5;
/** 業務の種類が要る人数（常時30人以上） */
export const REGISTER_JOB_TYPE_FROM = 30;
export const REGISTER_HISTORY_MAX = 30;
export const REGISTER_TEXT_MAX = 100;
export const REGISTER_DETAIL_MAX = 200;
export const REGISTER_JOB_TYPE_MAX = 100;

// ===== 履歴（1行 ＝「2024-04 営業部へ異動」。CSV の1つのセルの中と、画面の欄で同じ書き方） =====

// 先頭の年月：2024-04・2024/4・2024.04・2024年4月（日まであってもよい。月までを使う）
// toHalfWidth は1文字ずつ置き換えるので、半角にした文字で測った長さで、もとの文字を切ってよい
const HEAD = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?(?:\s*[-/.]?\s*\d{1,2}\s*日)?(?:\s*[-/.]\s*\d{1,2}(?!\d))?[\s:：]*/;

/** 1行を読む（空行は null） */
export function readHistoryLine(raw: string): RegisterLine | null {
  const line = raw.trim();
  if (!line) return null;
  const m = HEAD.exec(toHalfWidth(line));
  if (m) {
    const month = Number(m[2]);
    const text = line.slice(m[0].length).trim();
    if (month >= 1 && month <= 12 && text) return { month: `${m[1]}-${String(month).padStart(2, '0')}`, text };
  }
  return { month: null, text: line };
}

/** 改行で並んだ履歴を読む（Excel の Alt+Enter・CSV のセルの中の改行） */
export function parseHistory(text: string): RegisterLine[] {
  return text
    .split(/\r\n|\r|\n/)
    .map(readHistoryLine)
    .filter((l): l is RegisterLine => l !== null);
}

/** 履歴 → 改行で並べた文字（年月があれば先頭に） */
export function historyText(lines: readonly RegisterLine[]): string {
  return lines.map((l) => (l.month ? `${l.month} ${l.text}` : l.text)).join('\n');
}

/** 履歴の欄の問題（行が多すぎる・1行が長すぎる） */
export function historyProblem(lines: readonly RegisterLine[]): 'tooMany' | 'tooLong' | null {
  if (lines.length > REGISTER_HISTORY_MAX) return 'tooMany';
  if (lines.some((l) => l.text.length > REGISTER_TEXT_MAX)) return 'tooLong';
  return null;
}

// ===== 退職の事由（名簿の Excel の「事由」の欄は、選択肢でなく文で書かれていることが多い） =====

const EXACT: Record<string, RetireReason> = {
  退職: 'resign', resign: 'resign', 解雇: 'dismissal', dismissal: 'dismissal', 死亡: 'death', death: 'death',
  転勤: 'transfer', transfer: 'transfer', その他: 'other', other: 'other',
};

/**
 * 事由の文を読む：選択肢の言葉そのままなら詳しい内容はなし、文なら言葉から選んで文を詳しい内容に残す
 * 例：「懲戒解雇（無断欠勤）」→ 解雇＋その文／「自己都合」→ 退職＋その文／「病死」→ 死亡＋その文
 * 空なら null
 */
export function readRetireText(raw: string): { reason: RetireReason; detail: string | null } | null {
  const text = raw.trim();
  if (!text) return null;
  const exact = EXACT[toHalfWidth(text).toLowerCase()];
  if (exact) return { reason: exact, detail: null };
  const reason: RetireReason = /解雇/.test(text)
    ? 'dismissal'
    : /死亡|死去|逝去|病死|事故死/.test(text)
      ? 'death'
      : /転勤|転籍|移籍/.test(text)
        ? 'transfer'
        : /退職|自己都合|一身上|定年|満了|辞職|退任|会社都合/.test(text)
          ? 'resign'
          : 'other';
  return { reason, detail: text.slice(0, REGISTER_DETAIL_MAX) };
}

/** 事由の詳しい内容が要るか（解雇の理由・死亡の原因。労基則53条1項5号・6号） */
export function needsRetireDetail(reason: RetireReason | null | undefined): boolean {
  return reason === 'dismissal' || reason === 'death';
}

// ===== 名簿に載る人・記入漏れ =====

export interface RegisterPerson {
  hireDate: string;
  retireDate: string | null;
  retireReason: RetireReason | null;
  sex: 'male' | 'female' | null;
  org?: EmployeeOrg | null;
  contact: { address: string | null; overseasCountry?: string | null };
  foreign?: { noAddressReason: string | null } | null;
  register: RegisterDoc;
}

/** 労働者か（労働者でない役員は名簿に載せない。使用人を兼ねる役員は載せる） */
export function isWorker(p: Pick<RegisterPerson, 'org'>): boolean {
  const o = p.org?.officer;
  return !o || o.alsoEmployee === true;
}

function yearsBefore(date: string, years: number): string {
  return `${String(Number(date.slice(0, 4)) - years).padStart(4, '0')}${date.slice(4)}`;
}

/** 名簿に載る人（労働者で、入社済み。退職した人は保存の期間のうち） */
export function onRegister(p: Pick<RegisterPerson, 'org' | 'hireDate' | 'retireDate'>, today: string): boolean {
  if (!isWorker(p) || p.hireDate > today) return false;
  return !p.retireDate || p.retireDate >= yearsBefore(today, REGISTER_KEEP_YEARS);
}

/** 常時30人以上か（今日在籍している、名簿に載る人の数） */
export function registerLarge(people: readonly Pick<RegisterPerson, 'org' | 'hireDate' | 'retireDate'>[], today: string): boolean {
  const n = people.filter((p) => isWorker(p) && p.hireDate <= today && (!p.retireDate || p.retireDate >= today)).length;
  return n >= REGISTER_JOB_TYPE_FROM;
}

export const REGISTER_GAPS = ['sex', 'address', 'history', 'jobType', 'retireReason', 'retireDetail'] as const;
export type RegisterGap = (typeof REGISTER_GAPS)[number];

/** 名簿の記入漏れ（名簿に載らない人は空） */
export function registerGaps(p: RegisterPerson, today: string, large: boolean): RegisterGap[] {
  if (!onRegister(p, today)) return [];
  const gaps: RegisterGap[] = [];
  if (!p.sex) gaps.push('sex');
  // 住所：海外に住んでいる・住所を書けない理由がある外国人は、そちらで足りる
  if (!p.contact.address?.trim() && !p.contact.overseasCountry && !p.foreign?.noAddressReason) gaps.push('address');
  if (p.register.history.length === 0) gaps.push('history');
  if (large && !p.org?.jobType?.trim()) gaps.push('jobType');
  if (p.retireDate) {
    if (!p.retireReason) gaps.push('retireReason');
    else if (needsRetireDetail(p.retireReason) && !p.register.retireDetail?.trim()) gaps.push('retireDetail');
  }
  return gaps;
}

/** 何の漏れが何人か（取り込みの結果・To-do の説明） */
export function countGaps(list: readonly RegisterGap[][]): { people: number; by: Partial<Record<RegisterGap, number>> } {
  const by: Partial<Record<RegisterGap, number>> = {};
  let people = 0;
  for (const gaps of list) {
    if (gaps.length > 0) people++;
    for (const g of gaps) by[g] = (by[g] ?? 0) + 1;
  }
  return { people, by };
}

// ===== 取り込み：登録済みの同じ人の、名簿の空欄だけを埋める（上書きしない。11/24） =====

export interface RegisterFillSource {
  sex: 'male' | 'female' | null;
  retireDate: string | null;
  retireReason: RetireReason | null;
  org?: EmployeeOrg | null;
  contact: ContactDoc;
  register: RegisterDoc;
}

export interface RegisterFill {
  /** 従業員の文書・鍵付きの文書に重ねる項目（まとまりは丸ごと。中は今の値に空欄だけ足したもの） */
  patch: Partial<Pick<RegisterFillSource, 'sex' | 'retireReason' | 'org' | 'contact' | 'register'>>;
  /** 埋めた項目（記入漏れと同じ名前） */
  fields: RegisterGap[];
}

/**
 * saved：登録済みの値、file：ファイルの値。埋めるものがなければ null
 * - 住所は、郵便番号も住所も空の人だけ（住所変更届の宿題を作らないため。変わったのではなく、初めて入れる）
 * - 退職の理由・事由の内容は、登録済みの人が退職しているときだけ（退職日は取り込みで変えない）
 */
export function registerFill(saved: RegisterFillSource, file: RegisterFillSource): RegisterFill | null {
  const patch: RegisterFill['patch'] = {};
  const fields: RegisterGap[] = [];
  if (!saved.sex && file.sex) {
    patch.sex = file.sex;
    fields.push('sex');
  }
  if (!saved.contact.address?.trim() && !saved.contact.postalCode && file.contact.address?.trim()) {
    patch.contact = { ...saved.contact, postalCode: file.contact.postalCode, address: file.contact.address };
    fields.push('address');
  }
  if (!saved.org?.jobType?.trim() && file.org?.jobType?.trim()) {
    patch.org = { ...(saved.org ?? { departmentId: null, position: null, officer: null }), jobType: file.org.jobType };
    fields.push('jobType');
  }
  const register: RegisterDoc = { ...saved.register };
  if (saved.register.history.length === 0 && file.register.history.length > 0) {
    register.history = file.register.history;
    fields.push('history');
  }
  if (saved.retireDate) {
    if (!saved.retireReason && file.retireReason) {
      patch.retireReason = file.retireReason;
      fields.push('retireReason');
    }
    if (!saved.register.retireDetail?.trim() && file.register.retireDetail?.trim()) {
      register.retireDetail = file.register.retireDetail;
      fields.push('retireDetail');
    }
  }
  if (fields.includes('history') || fields.includes('retireDetail')) patch.register = register;
  return fields.length > 0 ? { patch, fields } : null;
}

// ===== 名簿の出力（様式第19号の欄の順。1人1行の一覧の形。様式は「項目がそろえば形は自由」） =====

export const REGISTER_TABLE_KEYS = [
  'kana', 'name', 'sex', 'birthDate', 'postalCode', 'address', 'hireDate', 'jobType', 'history', 'leaveDate', 'reason', 'note',
] as const;
export type RegisterTableKey = (typeof REGISTER_TABLE_KEYS)[number];

export interface RegisterRowSource extends RegisterPerson {
  employeeNumber: string | null;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  birthDate: string;
  contact: ContactDoc;
}

export interface RegisterTableText {
  header: (k: RegisterTableKey) => string;
  sex: (s: 'male' | 'female') => string;
  reason: (r: RetireReason) => string;
  /** 備考：使用人を兼ねる役員 */
  officerWorker: string;
  /** 住所の代わり：海外に住んでいる（国コード・都市） */
  overseas: (country: string, city: string | null) => string;
}

/**
 * 名簿の表（見出し＋名簿に載る人。並びは渡した順）
 * 事由：選択肢の言葉＋詳しい内容（例：解雇（業績不振による整理解雇））。履歴はセルの中で改行
 */
export function registerTable(people: readonly RegisterRowSource[], today: string, text: RegisterTableText): string[][] {
  const rows = people
    .filter((p) => onRegister(p, today))
    .map((p) => {
      const detail = p.register.retireDetail?.trim();
      const reason = p.retireDate && p.retireReason ? text.reason(p.retireReason) + (detail ? `（${detail}）` : '') : (detail ?? '');
      const address =
        p.contact.address?.trim() ||
        (p.contact.overseasCountry ? text.overseas(p.contact.overseasCountry, p.contact.overseasCity ?? null) : '');
      const v: Record<RegisterTableKey, string> = {
        kana: `${p.lastNameKana} ${p.firstNameKana}`.trim(),
        name: `${p.lastName} ${p.firstName}`.trim(),
        sex: p.sex ? text.sex(p.sex) : '',
        birthDate: p.birthDate,
        postalCode: p.contact.postalCode ? `${p.contact.postalCode.slice(0, 3)}-${p.contact.postalCode.slice(3)}` : '',
        address,
        hireDate: p.hireDate,
        jobType: p.org?.jobType ?? '',
        history: historyText(p.register.history),
        leaveDate: p.retireDate ?? '',
        reason: p.retireDate ? reason : '',
        note: p.org?.officer?.alsoEmployee ? text.officerWorker : '',
      };
      return REGISTER_TABLE_KEYS.map((k) => v[k]);
    });
  return [REGISTER_TABLE_KEYS.map(text.header), ...rows];
}
