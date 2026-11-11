import { nextStep, prevStep, stepBlocked, stepsFor } from './employee-steps';

describe('stepsFor：段の並び', () => {
  it('日本国籍は外国籍の段がない', () => {
    expect(stepsFor(false)).toEqual(['basic', 'employment', 'contract', 'private', 'confirm']);
  });
  it('外国籍は連絡先・口座のあとに外国籍の段', () => {
    expect(stepsFor(true)).toEqual(['basic', 'employment', 'contract', 'private', 'foreign', 'confirm']);
  });
});

describe('stepBlocked：その段の欄だけで判断する', () => {
  it('基本の段：ほかの段の欄のエラーでは止まらない', () => {
    expect(stepBlocked('basic', ['contact.postalCode'], ['bankIncomplete'])).toBeFalse();
  });
  it('基本の段：フリガナのエラーで止まる', () => {
    expect(stepBlocked('basic', ['lastNameKana'], [])).toBeTrue();
  });
  it('基本の段：外国籍のローマ字氏名は基本の段で見る（国籍は外国籍の段）', () => {
    expect(stepBlocked('basic', ['foreign.romanLastName'], [])).toBeTrue();
    expect(stepBlocked('basic', ['foreign.nationality'], [])).toBeFalse();
  });
  it('雇用・加入の段：まとまりの中の欄（health.acquiredDate）でも止まる', () => {
    expect(stepBlocked('employment', ['health.acquiredDate'], [])).toBeTrue();
  });
  it('連絡先・口座の段：口座の半端', () => {
    expect(stepBlocked('private', [], ['bankIncomplete'])).toBeTrue();
  });
  it('雇用契約の段：従業員のフォームのエラーでは止まらない（契約のフォームで確かめる）', () => {
    expect(stepBlocked('contract', ['lastNameKana'], ['bankIncomplete'])).toBeFalse();
  });
  it('確認の段：どこか1つでもエラーなら止まる', () => {
    expect(stepBlocked('confirm', [], ['certificateOrder'])).toBeTrue();
    expect(stepBlocked('confirm', [], [])).toBeFalse();
  });
  it('「foreign.kanjiName」を名前の頭が同じ別の欄と取り違えない', () => {
    expect(stepBlocked('basic', ['foreign.kanjiNameX'], [])).toBeFalse();
  });
});

describe('nextStep・prevStep', () => {
  const s = stepsFor(false);
  it('次・前。端ではそのまま', () => {
    expect(nextStep(s, 'basic')).toBe('employment');
    expect(nextStep(s, 'confirm')).toBe('confirm');
    expect(prevStep(s, 'employment')).toBe('basic');
    expect(prevStep(s, 'basic')).toBe('basic');
  });
});
