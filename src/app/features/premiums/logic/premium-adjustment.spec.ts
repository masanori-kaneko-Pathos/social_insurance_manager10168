import type { PickedRate } from '../../../core/models/rates';
import { makeGroups, makeLine } from './premium-core';
import { adjustmentPhase, adjustmentRatio, refundMonthOf, refundYen } from './premium-adjustment';
import { DEFAULT_PREMIUM_OPTIONS } from '../../../core/models/premium';

const rate = (employee: number, employer: number): PickedRate => ({ employee, employer, from: '2026-03' }) as PickedRate;
const PENSION = rate(91500, 91500); // 18.3%
const HEALTH10 = rate(50000, 50000); // 10%（機構の例）

describe('保険料調整制度（R48 の機構の表と突き合わせ。11/16）', () => {
  it('軽減割合：標準報酬月額ごと、25〜36か月目は半分、12.6万円を超えると0', () => {
    expect(adjustmentRatio(58000, 1)).toBe(2500);
    expect(adjustmentRatio(88000, 1)).toBe(2500);
    expect(adjustmentRatio(98000, 1)).toBe(2000);
    expect(adjustmentRatio(104000, 2)).toBe(700);
    expect(adjustmentRatio(126000, 1)).toBe(200);
    expect(adjustmentRatio(134000, 1)).toBe(0);
    expect(adjustmentRatio(88000, 0)).toBe(0);
  });

  it('厚年 1〜24か月目（表のとおり）', () => {
    const cases: [number, number, number, number][] = [
      // 標準報酬, 軽減割合, 本人負担（銭まで・0.001円単位）, 保険料軽減額
      [88000, 2500, 4026000, 4026],
      [98000, 2000, 5380200, 3587],
      [104000, 1400, 6851520, 2664],
      [110000, 900, 8253300, 1812],
      [118000, 500, 9717300, 1080],
      [126000, 200, 11067840, 461],
    ];
    for (const [std, bp, employeeMilli, refund] of cases) {
      const l = makeLine('pension', std, null, PENSION, bp);
      expect(l.employeeMilli).toBe(employeeMilli);
      expect(refundYen(l.reductionMilli!)).toBe(refund);
      expect(l.totalMilli - l.employeeMilli).toBe(l.totalMilli - employeeMilli); // 会社負担は全額 − 本人負担
    }
  });

  it('厚年 25〜36か月目（表のとおり）', () => {
    const l = makeLine('pension', 98000, null, PENSION, adjustmentRatio(98000, 2));
    expect(l.employeeMilli).toBe(7173600);
    expect(refundYen(l.reductionMilli!)).toBe(1793);
  });

  it('健保（料率10%の例）：58,000円 → 本人 1,450円、98,000円 → 本人 2,940円', () => {
    expect(makeLine('health', 58000, 1, HEALTH10, 2500).employeeMilli).toBe(1450000);
    const l = makeLine('health', 98000, 5, HEALTH10, 2000);
    expect(l.employeeMilli).toBe(2940000);
    expect(refundYen(l.reductionMilli!)).toBe(1960);
  });

  it('端数処理はふだんどおり（本人 6,851.52円 → 6,852円、会社 12,180円 ＋ 端数）', () => {
    const [g] = makeGroups([makeLine('pension', 104000, null, PENSION, 1400)], DEFAULT_PREMIUM_OPTIONS);
    expect(g.employeeYen).toBe(6852);
    expect(g.employerMilli).toBe(19032000 - 6852000);
  });

  it('軽減しないときは今までと同じ（reductionMilli なし）', () => {
    const l = makeLine('pension', 98000, null, PENSION);
    expect(l.employeeMilli).toBe(8967000);
    expect(l.reductionMilli).toBeUndefined();
  });

  it('通算の月数：対象だった月だけ数える（25か月目から半分、37か月目からなし）', () => {
    const all = () => true;
    expect(adjustmentPhase('2026-09', '2026-10', all)).toBe(0); // 始める前
    expect(adjustmentPhase('2026-10', '2026-10', all)).toBe(1); // 1か月目
    expect(adjustmentPhase('2028-09', '2026-10', all)).toBe(1); // 24か月目
    expect(adjustmentPhase('2028-10', '2026-10', all)).toBe(2); // 25か月目
    expect(adjustmentPhase('2029-09', '2026-10', all)).toBe(2); // 36か月目
    expect(adjustmentPhase('2029-10', '2026-10', all)).toBe(0); // 37か月目
    // 2027-01〜2027-06 は対象外（12.6万円を超えた）→ その6か月は数えない
    const gap = (m: string) => m < '2027-01' || m > '2027-06';
    expect(adjustmentPhase('2027-03', '2026-10', gap)).toBe(0);
    expect(adjustmentPhase('2029-03', '2026-10', gap)).toBe(1); // 30か月後だが、通算24か月目
    expect(adjustmentPhase('2029-04', '2026-10', gap)).toBe(2);
    expect(adjustmentPhase('2026-12', null, all)).toBe(0);
  });

  it('軽減額が差し引かれるのは3か月後の保険料', () => {
    expect(refundMonthOf('2026-10')).toBe('2027-01');
  });
});
