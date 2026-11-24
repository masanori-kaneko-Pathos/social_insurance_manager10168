/**
 * 合算して端数処理する単位の、保険ごとの本人負担（差し引き。11/24）
 * 健保 → ＋支援金 → ＋介護 の順にそれぞれ端数処理し、前との差をその保険の額にする。合計は合算の額と必ず同じ。
 * 例は、給与計算ソフトの会社が公開している計算例（令和8年度・東京の本人分の料率）
 */
import { PremiumOptions } from '../../../core/models/premium';
import { PickedRate } from '../../../core/models/rates';
import { makeGroups, makeLine } from './premium-core';

const half = (micro: number): PickedRate => ({ employee: micro, employer: micro, from: '2026-04', source: 'kyokai' });
// 本人分：健保 4.925%（49.25‰）・支援金 0.115%（1.15‰）・介護 0.81%（8.1‰）
const HEALTH = half(49250);
const SUPPORT = half(1150);
const CARE = half(8100);
const PAYROLL: PremiumOptions = { method: 'payroll', healthRounding: 'combined' };

const healthGroup = (base: number, options: PremiumOptions = PAYROLL, withCare = true) =>
  makeGroups(
    [
      makeLine('health', base, null, HEALTH),
      ...(withCare ? [makeLine('care', base, null, CARE)] : []),
      makeLine('childSupport', base, null, SUPPORT),
    ],
    options,
  )[0];

describe('partsYen：合算の単位の保険ごとの本人負担（差し引き）', () => {
  it('410,000円：健保 20,192.5 → 20,192 ／ ＋支援金 20,664 → 472 ／ ＋介護 23,985 → 3,321', () => {
    const g = healthGroup(410000);
    expect(g.employeeYen).toBe(23985);
    expect(g.partsYen).toEqual({ health: 20192, childSupport: 472, care: 3321 });
  });

  it('134,000円：合算は 7,839円。保険ごとに丸めて足すと 7,838円になる例でも、差し引きなら合計は 7,839円', () => {
    const g = healthGroup(134000);
    expect(g.employeeYen).toBe(7839);
    // 健保 6,599.5 → 6,599 ／ ＋支援金 6,753.6 → 6,754（155）／ ＋介護 7,839.0 → 7,839（1,085）
    expect(g.partsYen).toEqual({ health: 6599, childSupport: 155, care: 1085 });
  });

  it('介護がない人は 健保 → ＋支援金 の2つ', () => {
    const g = healthGroup(410000, PAYROLL, false);
    expect(g.partsYen).toEqual({ health: 20192, childSupport: 472 });
    expect(g.employeeYen).toBe(20664);
  });

  it('1つだけの単位（個別の端数処理・厚年）には partsYen を付けない', () => {
    const separate = makeGroups([makeLine('health', 410000, null, HEALTH), makeLine('care', 410000, null, CARE)], {
      method: 'payroll',
      healthRounding: 'separate',
    });
    expect(separate.every((g) => g.partsYen === undefined)).toBeTrue();
  });

  it('どの標準報酬・端数処理でも、保険ごとの額は0以上で、合計は合算の額と同じ', () => {
    const methods: PremiumOptions[] = [
      PAYROLL,
      { method: 'cash', healthRounding: 'combined' },
      { method: 'payroll', healthRounding: 'combined', agreementRounding: 'half' },
      { method: 'payroll', healthRounding: 'combined', agreementRounding: 'floor' },
      { method: 'payroll', healthRounding: 'combined', agreementRounding: 'ceil' },
    ];
    const bad: string[] = [];
    for (const options of methods) {
      for (let base = 58000; base <= 1390000; base += 1000) {
        const g = healthGroup(base, options);
        const parts = Object.values(g.partsYen ?? {}) as number[];
        const sum = parts.reduce((s, v) => s + v, 0);
        if (sum !== g.employeeYen || parts.some((v) => v < 0)) bad.push(`${base} ${JSON.stringify(options)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
