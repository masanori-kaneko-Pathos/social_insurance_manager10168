import { APPEAL_JA, bonusDecisionTextJa, decisionLinkRange, decisionTextJa, encodeBonusDecision, encodeDecision, encodeQualification, noticeLinkRange, parseBonusDecision, parseDecision, parseQualification, qualificationTextJa } from './decision-notice';

const d = { from: '2026-09', reason: 'regular' as const, health: { grade: 22, standard: 300000 }, pension: { grade: 19, standard: 300000 } };

describe('決定通知（B12）', () => {
  it('link に入れて読み戻せる。厚生年金がない人は -', () => {
    expect(encodeDecision(d)).toBe('decision|2026-09|regular|22|300000|19|300000');
    expect(parseDecision(encodeDecision(d))).toEqual(d);
    const over70 = { ...d, pension: null };
    expect(encodeDecision(over70)).toBe('decision|2026-09|regular|22|300000|-|-');
    expect(parseDecision(encodeDecision(over70))).toEqual(over70);
    expect(encodeDecision(d).length <= 200).toBeTrue();
  });
  it('依頼の ID などは決定通知ではない', () => {
    expect(parseDecision('abc123')).toBeNull();
    expect(parseDecision(null)).toBeNull();
    expect(parseDecision('decision|2026-13|regular|1|2|3|4')).toBeNull();
  });
  it('同じ月の範囲に入る', () => {
    const r = decisionLinkRange('2026-09');
    const link = encodeDecision(d);
    expect(link >= r.start && link < r.end).toBeTrue();
    expect(encodeDecision({ ...d, from: '2026-10' }) < r.end).toBeFalse();
  });
  it('日本語の控え', () => {
    const t = decisionTextJa(d);
    expect(t.title).toBe('標準報酬月額の決定のお知らせ（2026年9月分から）');
    expect(t.body.split('\n')).toEqual([
      '2026年9月分から、標準報酬月額が決まりました（定時決定）。',
      '健康保険：22級 300,000円',
      '厚生年金：19級 300,000円',
      '毎月の保険料の内訳は、マイページの保険料で確かめられます。',
      APPEAL_JA,
    ]);
    expect(t.title.length <= 100).toBeTrue();
  });
});

describe('標準賞与額・資格の取得と喪失の通知（健保法49条・厚年法29条。11/19）', () => {
  it('標準賞与額：書いて読むと同じ。入っていない保険は null', () => {
    const d = { paidDate: '2026-12-10', health: 300000, pension: null, employeeYen: 15000 };
    expect(parseBonusDecision(encodeBonusDecision(d))).toEqual(d);
    expect(parseBonusDecision('decision|2026-09|regular|1|1|-|-')).toBeNull();
    expect(parseBonusDecision('bonus|2026-13|1|1|1')).toBeNull();
  });
  it('資格の取得・喪失：書いて読むと同じ。月の範囲で探せる', () => {
    const d = { event: 'loss' as const, date: '2026-10-01', health: true, pension: false };
    const link = encodeQualification(d);
    expect(parseQualification(link)).toEqual(d);
    const r = noticeLinkRange('qual', '2026-10');
    expect(link >= r.start && link < r.end).toBeTrue();
    expect(parseQualification('qual|2026-10-01|other|HP')).toBeNull();
  });
  it('控えの文に、標準賞与額・本人負担・審査請求の教示が入る', () => {
    const t = bonusDecisionTextJa({ paidDate: '2026-12-10', health: 300000, pension: 300000, employeeYen: 44820 });
    expect(t.title).toBe('標準賞与額の決定のお知らせ（2026年12月10日支払）');
    expect(t.body).toContain('健康保険：300,000円');
    expect(t.body).toContain('この賞与の保険料（本人負担）：44,820円');
    expect(t.body).toContain(APPEAL_JA);
    expect(qualificationTextJa({ event: 'acquire', date: '2026-10-01', health: true, pension: true }).body).toContain('健康保険・厚生年金保険の被保険者の資格取得');
  });
});
