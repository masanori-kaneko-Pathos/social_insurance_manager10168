import type { RequestQuestion } from '../../../core/models/office-records';
import {
  answerErrors,
  ApplyTarget,
  changeRequestQuestions,
  cleanAnswers,
  customQuestion,
  fieldQuestion,
  isAnswerable,
  currentValue,
  planApply,
  sortRequests,
  templateQuestions,
} from './request-model';

const employee = (): ApplyTarget => ({
  contact: { postalCode: '1000001', address: '東京都千代田区1-1', phone: '03-1111-2222', email: null },
  commute: { method: null, route: null },
  bankAccount: { bankName: null, branchName: null, accountType: null, accountNumber: null, holderKana: null },
});

describe('ひな形', () => {
  it('入社の手続き：14項目（緊急連絡先を含む）。郵便番号・住所・電話だけ必須', () => {
    const q = templateQuestions('onboarding');
    expect(q.length).toBe(14);
    expect(q.filter((x) => x.required).map((x) => x.field)).toEqual(['contact.postalCode', 'contact.address', 'contact.phone']);
  });

  it('変更の届け：郵便番号・住所・通勤', () => {
    expect(templateQuestions('change').map((x) => x.field)).toEqual([
      'contact.postalCode', 'contact.address', 'commute.method', 'commute.route',
    ]);
  });

  it('従業員の申請：選んだ項目を、決まった順に、どれも必須で', () => {
    const q = changeRequestQuestions(['contact.phone', 'contact.address']);
    expect(q.map((x) => [x.field, x.required])).toEqual([['contact.address', true], ['contact.phone', true]]);
  });

  it('足した質問：ID は重ならない q 番号。選択肢は空を除く', () => {
    const base = [fieldQuestion('contact.address', true), { ...fieldQuestion('contact.phone', false), id: 'q1' }];
    const q = customQuestion(base, ' 制服のサイズ ', 'choice', ['S', ' M ', '', 'L'], true);
    expect(q).toEqual({ id: 'q2', label: '制服のサイズ', type: 'choice', choices: ['S', 'M', 'L'], required: true, field: null });
  });
});

describe('answerErrors', () => {
  const qs: RequestQuestion[] = [
    fieldQuestion('contact.postalCode', true),
    fieldQuestion('bankAccount.accountType', false),
    fieldQuestion('bankAccount.holderKana', false),
    { id: 'q1', label: '入社日', type: 'date', choices: null, required: false, field: null },
    { id: 'q2', label: '車通勤', type: 'yesno', choices: null, required: true, field: null },
  ];

  it('必須の空・形の間違い', () => {
    expect(answerErrors(qs, { 'bankAccount.accountType': 'other', 'bankAccount.holderKana': 'やまだ', q1: '2026/11/01' })).toEqual({
      'contact.postalCode': 'required',
      'bankAccount.accountType': 'format',
      'bankAccount.holderKana': 'format',
      q1: 'format',
      q2: 'required',
    });
  });

  it('全角・ハイフン入りの郵便番号は読める', () => {
    expect(answerErrors(qs, { 'contact.postalCode': '１００－０００５', q2: 'no' })).toEqual({});
  });
});

describe('planApply：承認したときの書き換え', () => {
  const qs = [
    fieldQuestion('contact.postalCode', true),
    fieldQuestion('contact.address', true),
    fieldQuestion('contact.phone', false),
    fieldQuestion('bankAccount.accountNumber', false),
    { id: 'q1', label: 'メモ', type: 'text' as const, choices: null, required: false, field: null },
  ];

  it('変わる項目だけ。まとまりごとに今の値へ重ねる', () => {
    const r = planApply(employee(), qs, {
      'contact.postalCode': '100-0005',
      'contact.address': '東京都千代田区丸の内1-1',
      'contact.phone': '03-1111-2222', // 同じ → 書かない
      'bankAccount.accountNumber': '１２３４５６７',
      q1: '書き込み先なし',
    });
    expect(r.changes).toEqual([
      { field: 'contact.postalCode', before: '1000001', after: '1000005' },
      { field: 'contact.address', before: '東京都千代田区1-1', after: '東京都千代田区丸の内1-1' },
      { field: 'bankAccount.accountNumber', before: null, after: '1234567' },
    ]);
    expect(r.patch.contact).toEqual({ postalCode: '1000005', address: '東京都千代田区丸の内1-1', phone: '03-1111-2222', email: null });
    expect(r.patch.bankAccount?.accountNumber).toBe('1234567');
    expect(r.patch.bankAccount?.bankName).toBeNull();
    expect(r.patch.commute).toBeUndefined();
  });

  it('空の答えでは消さない', () => {
    expect(planApply(employee(), qs, { 'contact.address': '' }).changes).toEqual([]);
  });
});

describe('cleanAnswers・状態・並び', () => {
  it('空を除き、前後の空白を取る', () => {
    const qs = [fieldQuestion('contact.address', true), fieldQuestion('contact.phone', false)];
    expect(cleanAnswers(qs, { 'contact.address': '  大阪 ', 'contact.phone': ' ', extra: 'x' })).toEqual({ 'contact.address': '大阪' });
  });

  it('答えられるのは「まだ」と「差し戻し」', () => {
    expect(isAnswerable('open')).toBeTrue();
    expect(isAnswerable('rejected')).toBeTrue();
    expect(isAnswerable('submitted')).toBeFalse();
    expect(isAnswerable('approved')).toBeFalse();
  });

  it('確認待ち → 回答待ち → 差し戻し → 承認済み、同じなら新しい順', () => {
    const r = sortRequests([
      { status: 'approved' as const, updatedMs: 9 },
      { status: 'open' as const, updatedMs: 1 },
      { status: 'submitted' as const, updatedMs: 2 },
      { status: 'submitted' as const, updatedMs: 5 },
      { status: 'rejected' as const, updatedMs: 3 },
    ]);
    expect(r.map((x) => `${x.status}${x.updatedMs}`)).toEqual(['submitted5', 'submitted2', 'open1', 'rejected3', 'approved9']);
  });
});

describe('緊急連絡先（依頼・申請では1件目だけ）', () => {
  it('今の値は1件目から読む。なければ null', () => {
    const e = employee();
    expect(currentValue(e, 'contact.emergencyName')).toBeNull();
    const withEm = { ...e, contact: { ...e.contact, emergencyContacts: [{ name: '山田 花子', relation: '母', phone: '0900000000' }] } };
    expect(currentValue(withEm, 'contact.emergencyRelation')).toBe('母');
  });
  it('承認すると1件目を書き換え、2件目は残す', () => {
    const e = employee();
    const two = {
      ...e,
      contact: {
        ...e.contact,
        emergencyContacts: [
          { name: '山田 花子', relation: '母', phone: '0900000000' },
          { name: '山田 次郎', relation: '兄', phone: '0800000000' },
        ],
      },
    };
    const qs = changeRequestQuestions(['contact.emergencyName', 'contact.emergencyPhone']);
    const r = planApply(two, qs, { 'contact.emergencyName': '山田 一子', 'contact.emergencyPhone': '090-9999-9999' });
    expect(r.patch.contact?.emergencyContacts).toEqual([
      { name: '山田 一子', relation: '母', phone: '090-9999-9999' },
      { name: '山田 次郎', relation: '兄', phone: '0800000000' },
    ]);
    expect(r.changes.map((c) => c.field)).toEqual(['contact.emergencyName', 'contact.emergencyPhone']);
  });
  it('まだ1件もなければ、1件目を作る', () => {
    const qs = changeRequestQuestions(['contact.emergencyRelation']);
    const r = planApply(employee(), qs, { 'contact.emergencyRelation': '配偶者' });
    expect(r.patch.contact?.emergencyContacts).toEqual([{ name: null, relation: '配偶者', phone: null }]);
  });
});
