// マイページの「そのほかの届け」：氏名が変わった・家族が増えた／減った（カタログ【4】【5】の身上変更）
// Angular・Firebase に依存しない純粋な関数
//
// - 氏名：承認すると従業員の氏名に書き込む（変更履歴つき）。氏名変更届が要るかもしれない人には宿題を出す
//   （要るのは：マイナンバーと基礎年金番号が結びついていない人・協会けんぽの健保だけの人・短期在留の外国人。日本年金機構）
// - 家族：承認しても扶養の登録はしない（収入・同居などを人が確かめる）。被扶養者（異動）届の宿題を出す

import type { RequestQuestion } from '../../../core/models/office-records';

/** 質問の ID（答えの鍵。ドットを含めない） */
export const NAME_IDS = ['nameLast', 'nameFirst', 'nameLastKana', 'nameFirstKana', 'nameDate'] as const;
export const FAMILY_IDS = ['familyKind', 'familyName', 'familyRelation', 'familyDate', 'familyNote'] as const;

type Label = (key: string) => string;

/** 氏名が変わった：新しい姓・名・フリガナと、変わった日 */
export function nameQuestions(t: Label): RequestQuestion[] {
  return [
    { id: 'nameLast', label: t('me.newName.last'), type: 'text', choices: null, required: true, field: null },
    { id: 'nameFirst', label: t('me.newName.first'), type: 'text', choices: null, required: false, field: null },
    { id: 'nameLastKana', label: t('me.newName.lastKana'), type: 'text', choices: null, required: true, field: null },
    { id: 'nameFirstKana', label: t('me.newName.firstKana'), type: 'text', choices: null, required: false, field: null },
    { id: 'nameDate', label: t('me.newName.date'), type: 'date', choices: null, required: true, field: null },
  ];
}

/** 家族が増えた・減った：どちらか・家族の氏名・続柄・日付・ひとこと */
export function familyQuestions(t: Label): RequestQuestion[] {
  return [
    {
      id: 'familyKind',
      label: t('me.family.kind'),
      type: 'choice',
      choices: [t('me.family.increase'), t('me.family.decrease')],
      required: true,
      field: null,
    },
    { id: 'familyName', label: t('me.family.name'), type: 'text', choices: null, required: true, field: null },
    { id: 'familyRelation', label: t('me.family.relation'), type: 'text', choices: null, required: true, field: null },
    { id: 'familyDate', label: t('me.family.date'), type: 'date', choices: null, required: true, field: null },
    { id: 'familyNote', label: t('me.family.note'), type: 'text', choices: null, required: false, field: null },
  ];
}

const has = (qs: readonly RequestQuestion[], id: string) => qs.some((q) => q.id === id);
const ans = (a: Readonly<Record<string, string>>, id: string) => (a[id] ?? '').trim();

export interface NameChange {
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  date: string;
}

/** 答えから新しい氏名（氏名の質問がない・姓かフリガナが空なら null） */
export function nameChangeFrom(
  qs: readonly RequestQuestion[],
  a: Readonly<Record<string, string>>,
): NameChange | null {
  if (!has(qs, 'nameLast')) return null;
  const lastName = ans(a, 'nameLast');
  const lastNameKana = ans(a, 'nameLastKana');
  if (!lastName || !lastNameKana) return null;
  return {
    lastName,
    firstName: ans(a, 'nameFirst'),
    lastNameKana,
    firstNameKana: ans(a, 'nameFirstKana'),
    date: ans(a, 'nameDate'),
  };
}

export interface FamilyEvent {
  kind: 'increase' | 'decrease';
  date: string;
}

/** 答えから家族の増減（どちらかは、選択肢の何番目かで決める。言語が違っても読める） */
export function familyEventFrom(
  qs: readonly RequestQuestion[],
  a: Readonly<Record<string, string>>,
): FamilyEvent | null {
  const q = qs.find((x) => x.id === 'familyKind');
  if (!q) return null;
  const i = (q.choices ?? []).indexOf(ans(a, 'familyKind'));
  if (i < 0) return null;
  return { kind: i === 0 ? 'increase' : 'decrease', date: ans(a, 'familyDate') };
}

export type NameFilingReason = 'noMyNumber' | 'healthOnly' | 'shortStay';

/** 被保険者氏名変更届が要るかもしれない理由（協会けんぽの健保だけの人は、結びついていても要る） */
export function nameFilingReasons(p: {
  myNumberRegistered: boolean | null;
  healthEnrolled: boolean;
  pensionEnrolled: boolean;
  kyokai: boolean;
  shortStay: boolean;
}): NameFilingReason[] {
  const out: NameFilingReason[] = [];
  if (p.myNumberRegistered === false) out.push('noMyNumber');
  if (p.kyokai && p.healthEnrolled && !p.pensionEnrolled) out.push('healthOnly');
  if (p.shortStay) out.push('shortStay');
  return out;
}
