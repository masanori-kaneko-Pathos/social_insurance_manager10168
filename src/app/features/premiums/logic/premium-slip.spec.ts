import type { PremiumGroup, PremiumLine, PremiumResult } from '../../../core/models/premium';
import { premiumSlip } from './premium-slip';

const rate = { employee: 0, employer: 0, from: '2026-03' } as PremiumLine['rate'];
const line = (part: PremiumLine['part'], totalMilli: number, employeeMilli: number): PremiumLine => ({
  part, base: 340000, grade: 24, rate, totalMilli, employeeMilli,
});
const group = (lines: PremiumLine[], employeeYen: number): PremiumGroup => {
  const totalMilli = lines.reduce((s, l) => s + l.totalMilli, 0);
  return { parts: lines.map((l) => l.part), lines, totalMilli, employeeYen, employerMilli: totalMilli - employeeYen * 1000 };
};
const result = (groups: PremiumGroup[]): PremiumResult => ({
  kind: 'monthly', month: '2026-11', groups, missing: [],
  totalMilli: groups.reduce((s, g) => s + g.totalMilli, 0),
  employeeYen: groups.reduce((s, g) => s + g.employeeYen, 0),
  employerMilli: groups.reduce((s, g) => s + g.employerMilli, 0),
});

// 画面の岡田さん（340,000円・東京・40歳以上）
const health = group([line('health', 33490000, 16745000), line('care', 5508000, 2754000), line('childSupport', 782000, 391000)], 19890);
const pension = group([line('pension', 62220000, 31110000)], 31110);
const contribution = group([line('childContribution', 1224000, 0)], 0);

describe('premiumSlip（給与明細の形。11/16）', () => {
  it('合算の単位は保険ごとの行 ＋ 端数処理のあとの行、1つだけの単位は1行', () => {
    const s = premiumSlip(result([health, pension, contribution]));
    expect(s.rows.map((r) => `${r.kind}:${r.parts.join('+')}`)).toEqual([
      'line:health', 'line:care', 'line:childSupport', 'rounded:health+care+childSupport', 'line:pension',
    ]);
    expect(s.rows[0].employeeMilli).toBe(16745000);
    expect(s.rows[0].employerMilli).toBe(16745000);
    expect(s.rows[3].employeeMilli).toBe(19890000);
    expect(s.rows[4].employeeMilli).toBe(31110000);
  });

  it('合計は保険料だけ（拠出金は別）', () => {
    const s = premiumSlip(result([health, pension, contribution]));
    expect(s.total.employeeYen).toBe(51000);
    expect(s.total.totalMilli).toBe(102000000);
    expect(s.total.employerMilli).toBe(51000000);
    expect(s.contribution).toEqual({ employerMilli: 1224000 });
  });

  it('端数処理で本人分が変わる例：銭は保険ごとの行に残り、端数処理のあとの行で円になる', () => {
    const g = group([line('health', 15210500, 7605250), line('care', 2478600, 1239300)], 8844);
    const s = premiumSlip(result([g]));
    expect(s.rows[0].employeeMilli).toBe(7605250);
    expect(s.rows[2].kind).toBe('rounded');
    expect(s.rows[2].employeeMilli).toBe(8844000);
    expect(s.contribution).toBeNull();
  });
});

describe('premiumSlip：保険料調整制度の軽減（11/16）', () => {
  it('行の reductionMilli を足す（なければ 0）', () => {
    const l = { ...line('pension', 17934000, 5380200), reductionMilli: 3586800 };
    expect(premiumSlip(result([group([l], 5380)])).reductionMilli).toBe(3586800);
    expect(premiumSlip(result([health])).reductionMilli).toBe(0);
  });
});
