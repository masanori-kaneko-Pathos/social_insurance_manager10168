import { decisionLinkRange, decisionTextJa, encodeDecision, parseDecision } from './decision-notice';

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
    ]);
    expect(t.title.length <= 100).toBeTrue();
  });
});
