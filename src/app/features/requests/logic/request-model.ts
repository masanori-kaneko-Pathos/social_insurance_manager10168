// 依頼と申請（カタログ【4】）
// Angular・Firebase に依存しない純粋な関数
//
// - 管理者 → 従業員の「依頼」：ひな形（入社の手続き・変更の届け・自由）＋ 足した質問
// - 従業員 → 管理者の「申請」：住所などの変更
// 質問に field（'contact.address' など）があれば、承認したときに従業員の情報へ書き込む。
// 書き込める項目は、ここに並べたものだけ（マイナンバーなどは入れない）

import type { AccountType, BankAccountDoc, CommuteDoc, ContactDoc } from '../../../core/models/employee';
import type { QuestionType, RequestQuestion, RequestStatus, RequestType } from '../../../core/models/office-records';
import { DATE_RE } from '../../../shared/utils/date';
import { toHalfWidth } from '../../../shared/utils/text';

// ===== 書き込める項目 =====

export const REQUEST_FIELDS = [
  'contact.postalCode',
  'contact.address',
  'contact.phone',
  'contact.email',
  'commute.method',
  'commute.route',
  'bankAccount.bankName',
  'bankAccount.branchName',
  'bankAccount.accountType',
  'bankAccount.accountNumber',
  'bankAccount.holderKana',
] as const;
export type RequestField = (typeof REQUEST_FIELDS)[number];

const ACCOUNT_TYPES: AccountType[] = ['ordinary', 'current', 'savings'];

interface FieldSpec {
  type: QuestionType;
  choices: string[] | null;
  /** 答えの文字 → 保存する値（読めなければ undefined） */
  normalize: (s: string) => string | undefined;
}

const upTo = (max: number) => (s: string) => {
  const t = s.trim();
  return t.length > 0 && t.length <= max ? t : undefined;
};

export const FIELD_SPECS: Record<RequestField, FieldSpec> = {
  'contact.postalCode': {
    type: 'text',
    choices: null,
    normalize: (s) => {
      const t = toHalfWidth(s).replace(/[-‐ー－\s]/g, '');
      return /^\d{7}$/.test(t) ? t : undefined;
    },
  },
  'contact.address': { type: 'text', choices: null, normalize: upTo(200) },
  'contact.phone': {
    type: 'text',
    choices: null,
    normalize: (s) => {
      const t = toHalfWidth(s).trim();
      return /^\+?[\d\-()\s]{6,20}$/.test(t) ? t : undefined;
    },
  },
  'contact.email': {
    type: 'text',
    choices: null,
    normalize: (s) => {
      const t = toHalfWidth(s).trim();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) && t.length <= 254 ? t : undefined;
    },
  },
  'commute.method': { type: 'text', choices: null, normalize: upTo(50) },
  'commute.route': { type: 'text', choices: null, normalize: upTo(200) },
  'bankAccount.bankName': { type: 'text', choices: null, normalize: upTo(50) },
  'bankAccount.branchName': { type: 'text', choices: null, normalize: upTo(50) },
  'bankAccount.accountType': {
    type: 'choice',
    choices: ACCOUNT_TYPES,
    normalize: (s) => (ACCOUNT_TYPES.includes(s as AccountType) ? s : undefined),
  },
  'bankAccount.accountNumber': {
    type: 'text',
    choices: null,
    normalize: (s) => {
      const t = toHalfWidth(s).replace(/\s/g, '');
      return /^\d{7}$/.test(t) ? t : undefined;
    },
  },
  'bankAccount.holderKana': {
    type: 'text',
    choices: null,
    normalize: (s) => {
      const t = s.trim().replace(/　/g, ' ');
      return /^[ァ-ヶー\s（）().．\-‐・]+$/.test(t) && t.length <= 100 ? t : undefined;
    },
  },
};

export function isRequestField(v: string | null): v is RequestField {
  return v !== null && (REQUEST_FIELDS as readonly string[]).includes(v);
}

/** 項目から質問を作る（ID は項目名。画面の見出しは翻訳の request.field.* を使う） */
export function fieldQuestion(field: RequestField, required: boolean): RequestQuestion {
  const spec = FIELD_SPECS[field];
  return { id: field, label: field, type: spec.type, choices: spec.choices, required, field };
}

// ===== ひな形 =====

/** 入社の手続き：連絡先・通勤・口座（住所・郵便番号・電話は必須） */
const ONBOARDING_REQUIRED: RequestField[] = ['contact.postalCode', 'contact.address', 'contact.phone'];

export function templateQuestions(type: RequestType): RequestQuestion[] {
  switch (type) {
    case 'onboarding':
      return REQUEST_FIELDS.map((f) => fieldQuestion(f, ONBOARDING_REQUIRED.includes(f)));
    case 'change':
      // 変更の届け：住所が変わったとき（郵便番号・住所・通勤）
      return (['contact.postalCode', 'contact.address', 'commute.method', 'commute.route'] as RequestField[]).map((f) =>
        fieldQuestion(f, f === 'contact.postalCode' || f === 'contact.address'),
      );
    case 'custom':
      return [];
  }
}

/** 従業員からの変更の申請：選んだ項目を、どれも必須の質問にする */
export function changeRequestQuestions(fields: RequestField[]): RequestQuestion[] {
  return REQUEST_FIELDS.filter((f) => fields.includes(f)).map((f) => fieldQuestion(f, true));
}

/** 足した質問（書き込み先なし）。ID は q1, q2 … で、今ある質問と重ならないもの */
export function customQuestion(
  existing: readonly RequestQuestion[],
  label: string,
  type: QuestionType,
  choices: string[] | null,
  required: boolean,
): RequestQuestion {
  let n = 1;
  const ids = new Set(existing.map((q) => q.id));
  while (ids.has(`q${n}`)) n++;
  return {
    id: `q${n}`,
    label: label.trim().slice(0, 100),
    type,
    choices: type === 'choice' ? (choices ?? []).map((c) => c.trim()).filter((c) => c).slice(0, 20) : null,
    required,
    field: null,
  };
}

// ===== 答えのチェック =====

export type AnswerError = 'required' | 'format' | 'tooLong';

export function answerErrors(
  questions: readonly RequestQuestion[],
  answers: Readonly<Record<string, string>>,
): Record<string, AnswerError> {
  const out: Record<string, AnswerError> = {};
  for (const q of questions) {
    const a = (answers[q.id] ?? '').trim();
    if (a === '') {
      if (q.required) out[q.id] = 'required';
      continue;
    }
    if (isRequestField(q.field)) {
      if (FIELD_SPECS[q.field].normalize(a) === undefined) out[q.id] = 'format';
      continue;
    }
    if (a.length > 1000) out[q.id] = 'tooLong';
    else if (q.type === 'date' && !DATE_RE.test(a)) out[q.id] = 'format';
    else if (q.type === 'number' && !/^-?\d+(\.\d+)?$/.test(toHalfWidth(a))) out[q.id] = 'format';
    else if (q.type === 'choice' && !(q.choices ?? []).includes(a)) out[q.id] = 'format';
    else if (q.type === 'yesno' && a !== 'yes' && a !== 'no') out[q.id] = 'format';
  }
  return out;
}

/** 保存する答え（空は入れない・前後の空白を取る・50件まで） */
export function cleanAnswers(
  questions: readonly RequestQuestion[],
  answers: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions.slice(0, 50)) {
    const a = (answers[q.id] ?? '').trim();
    if (a !== '') out[q.id] = a.slice(0, 1000);
  }
  return out;
}

// ===== 承認：従業員の情報へ書き込む =====

export interface ApplyTarget {
  contact: ContactDoc;
  commute: CommuteDoc;
  bankAccount: BankAccountDoc;
}

export interface FieldChange {
  field: RequestField;
  before: string | null;
  after: string;
}

/** 今の値（画面で答えと並べる） */
export function currentValue(e: ApplyTarget, field: RequestField): string | null {
  const [group, key] = field.split('.') as [keyof ApplyTarget, string];
  return ((e[group] as unknown as Record<string, string | null>)[key] ?? null) as string | null;
}

/**
 * 答えから、従業員の情報の書き換えを作る
 * - 書き込み先のある質問だけ。空の答え・今と同じ値は書かない（消すことはしない）
 * - まとまり（contact・commute・bankAccount）ごとに、今の値に重ねた全体を返す（ルールが全部の項目を求めるため）
 */
export function planApply(
  e: ApplyTarget,
  questions: readonly RequestQuestion[],
  answers: Readonly<Record<string, string>>,
): { patch: Partial<ApplyTarget>; changes: FieldChange[] } {
  const changes: FieldChange[] = [];
  const patch: Partial<Record<keyof ApplyTarget, Record<string, unknown>>> = {};
  for (const q of questions) {
    if (!isRequestField(q.field)) continue;
    const raw = (answers[q.id] ?? '').trim();
    if (raw === '') continue;
    const after = FIELD_SPECS[q.field].normalize(raw);
    if (after === undefined) continue;
    const before = currentValue(e, q.field);
    if (before === after) continue;
    const [group, key] = q.field.split('.') as [keyof ApplyTarget, string];
    patch[group] ??= { ...(e[group] as unknown as Record<string, unknown>) };
    patch[group]![key] = after;
    changes.push({ field: q.field, before, after });
  }
  return { patch: patch as Partial<ApplyTarget>, changes };
}

// ===== 状態 =====

/** 従業員が答えを直して出せる状態（まだ・差し戻し） */
export function isAnswerable(status: RequestStatus): boolean {
  return status === 'open' || status === 'rejected';
}

/** 一覧の並び：確認待ち → 回答待ち → 差し戻し → 承認済み */
const STATUS_ORDER: Record<RequestStatus, number> = { submitted: 0, open: 1, rejected: 2, approved: 3 };

export function sortRequests<T extends { status: RequestStatus; updatedMs: number }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.updatedMs - a.updatedMs);
}
