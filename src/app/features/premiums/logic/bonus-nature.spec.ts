import {
  bonusRemunerationOf,
  irregularBonusYearOf,
  isRemunerationBonus,
  NaturePaymentLike,
  periodYearOf,
} from './bonus-nature';

const pay = (
  id: string,
  paidDate: string,
  amounts: Record<string, number>,
  extra: Partial<NaturePaymentLike> = {},
): NaturePaymentLike => ({ id, paidDate, amounts, ...extra });

describe('periodYearOf / irregularBonusYearOf', () => {
  it('9〜12月はその年、1〜8月は前の年の定時決定の期間', () => {
    expect(periodYearOf('2026-09-01')).toBe(2026);
    expect(periodYearOf('2026-12-10')).toBe(2026);
    expect(periodYearOf('2026-08-31')).toBe(2025);
    expect(periodYearOf('2027-03-25')).toBe(2026);
  });
  it('随時改定：7月以降に改定ならその年、1〜6月なら前の年の額', () => {
    expect(irregularBonusYearOf('2026-08')).toBe(2026);
    expect(irregularBonusYearOf('2026-11')).toBe(2026);
    expect(irregularBonusYearOf('2027-02')).toBe(2026);
  });
});

describe('賞与に係る報酬（年4回以上。局部長通知・令和5年Q&A。11/19）', () => {
  // 四半期インセンティブ：9月・12月・3月・6月（7/1前の1年に4回）
  const q = { nature: '四半期インセンティブ' };
  const quarter = [
    pay('a', '2025-09-25', { e1: 100_000 }, q),
    pay('b', '2025-12-25', { e1: 350_000 }, q),
    pay('c', '2026-03-25', { e1: 150_000 }, q),
    pay('d', '2026-06-25', { e1: 240_000 }, q),
  ];

  it('7/1前1年に4回 → 合計 ÷ 12 を足す（84万円 ÷ 12 ＝ 7万円）', () => {
    const r = bonusRemunerationOf('e1', 2026, quarter);
    expect(r.annual).toBe(840_000);
    expect(r.monthly).toBe(70_000);
    expect(r.natures).toEqual([{ nature: '四半期インセンティブ', count: 4, total: 840_000 }]);
  });

  it('最初の年の4回は賞与のまま（前の年の実績がない。Q4）。9月以降の支給から報酬', () => {
    for (const p of quarter) expect(isRemunerationBonus('e1', p, quarter)).toBeFalse();
    const sep = pay('e', '2026-09-25', { e1: 120_000 }, q);
    expect(isRemunerationBonus('e1', sep, [...quarter, sep])).toBeTrue();
  });

  it('7・8月の支給はまだ前の年の区分（次の定時決定が適用されるまで変わらない）', () => {
    const jul = pay('j', '2026-07-25', { e1: 100_000 }, q);
    expect(isRemunerationBonus('e1', jul, [...quarter, jul])).toBeFalse();
  });

  it('性質が違えば別々に数える：夏・冬・決算（賞与 3回）＋インフレ手当 1回 → どれも賞与', () => {
    const list = [
      pay('s', '2025-07-10', { e1: 400_000 }),
      pay('w', '2025-12-10', { e1: 400_000 }),
      pay('k', '2026-03-31', { e1: 200_000 }),
      pay('i', '2026-05-20', { e1: 50_000 }, { nature: 'インフレ手当' }),
    ];
    expect(bonusRemunerationOf('e1', 2026, list).monthly).toBe(0);
    const next = pay('n', '2026-12-10', { e1: 400_000 });
    expect(isRemunerationBonus('e1', next, [...list, next])).toBeFalse();
  });

  it('名称（title）が違っても、性質が同じなら1つに数える', () => {
    const list = [
      pay('s', '2025-07-10', { e1: 100_000 }, { nature: '賞与' }),
      pay('w', '2025-12-10', { e1: 100_000 }, { nature: ' 賞与 ' }),
      pay('k', '2026-03-31', { e1: 100_000 }, { nature: null }),
      pay('x', '2026-06-10', { e1: 120_000 }),
    ];
    expect(bonusRemunerationOf('e1', 2026, list).monthly).toBe(35_000);
  });

  it('人ごとに数える：上位の人だけ4回受けたら、その人だけ報酬', () => {
    const list = quarter.map((p, i) => ({ ...p, amounts: { e1: p.amounts['e1'], ...(i < 3 ? { e2: 50_000 } : {}) } }));
    const sep = pay('e', '2026-09-25', { e1: 1, e2: 1 }, q);
    expect(isRemunerationBonus('e1', sep, [...list, sep])).toBeTrue();
    expect(isRemunerationBonus('e2', sep, [...list, sep])).toBeFalse();
  });

  it('分割の続きは数えないが額は足す。その年に限りの支給は数えず、額も足さず、賞与のまま', () => {
    const list = [
      ...quarter.slice(0, 3),
      pay('d1', '2026-06-10', { e1: 120_000 }, q),
      pay('d2', '2026-06-25', { e1: 120_000 }, { ...q, countAs: 'split' }),
      pay('one', '2026-04-10', { e1: 300_000 }, { ...q, countAs: 'oneOff' }),
    ];
    const r = bonusRemunerationOf('e1', 2026, list);
    expect(r.natures[0].count).toBe(4);
    expect(r.annual).toBe(840_000);
    const oneOff = pay('one2', '2026-10-10', { e1: 300_000 }, { ...q, countAs: 'oneOff' });
    expect(isRemunerationBonus('e1', oneOff, [...list, oneOff])).toBeFalse();
  });

  it('3回しかなければ足さない（規程に4回と書いてあっても実績で。Q8）', () => {
    expect(bonusRemunerationOf('e1', 2026, quarter.slice(0, 3)).monthly).toBe(0);
  });

  it('現物も額に入れる', () => {
    const list = quarter.map((p) => ({ ...p, inKindAmounts: { e1: 1_200 } }));
    expect(bonusRemunerationOf('e1', 2026, list).annual).toBe(844_800);
    expect(bonusRemunerationOf('e1', 2026, list).monthly).toBe(70_400);
  });
});
