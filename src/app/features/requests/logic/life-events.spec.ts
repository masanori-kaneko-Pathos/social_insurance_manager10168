import { familyEventFrom, familyQuestions, nameChangeFrom, nameFilingReasons, nameQuestions } from './life-events';

const t = (k: string) => k;

describe('氏名が変わった', () => {
  it('答えから新しい氏名を読む。姓かフリガナが空なら読まない', () => {
    const qs = nameQuestions(t);
    const a = { nameLast: ' 山田 ', nameFirst: '花子', nameLastKana: 'ヤマダ', nameFirstKana: 'ハナコ', nameDate: '2026-11-01' };
    expect(nameChangeFrom(qs, a)).toEqual({
      lastName: '山田',
      firstName: '花子',
      lastNameKana: 'ヤマダ',
      firstNameKana: 'ハナコ',
      date: '2026-11-01',
    });
    expect(nameChangeFrom(qs, { ...a, nameLastKana: '' })).toBeNull();
    expect(nameChangeFrom([], a)).toBeNull();
  });
  it('氏名変更届が要るかもしれない理由', () => {
    const base = { myNumberRegistered: true, healthEnrolled: true, pensionEnrolled: true, kyokai: true, shortStay: false };
    expect(nameFilingReasons(base)).toEqual([]);
    expect(nameFilingReasons({ ...base, myNumberRegistered: false })).toEqual(['noMyNumber']);
    expect(nameFilingReasons({ ...base, pensionEnrolled: false })).toEqual(['healthOnly']);
    expect(nameFilingReasons({ ...base, pensionEnrolled: false, kyokai: false })).toEqual([]);
    expect(nameFilingReasons({ ...base, shortStay: true })).toEqual(['shortStay']);
  });
});

describe('家族が増えた・減った', () => {
  it('選択肢の何番目かで増減を決める', () => {
    const qs = familyQuestions(t);
    expect(familyEventFrom(qs, { familyKind: 'me.family.increase', familyDate: '2026-11-01' })).toEqual({
      kind: 'increase',
      date: '2026-11-01',
    });
    expect(familyEventFrom(qs, { familyKind: 'me.family.decrease' })?.kind).toBe('decrease');
    expect(familyEventFrom(qs, { familyKind: '?' })).toBeNull();
  });
});
