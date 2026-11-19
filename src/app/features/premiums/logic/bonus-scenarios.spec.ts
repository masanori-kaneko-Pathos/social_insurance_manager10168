/**
 * 年4回以上の賞与の場合分け（11/19）。法律・通知どおりになっているかを、ケースごとに確かめる
 *
 * 根拠
 * - 局部長通知（昭和53年 保発47）1(1)：7月1日現在、ア 規程で年4回以上と客観的に定められている、または
 *   イ 7月1日前の1年間に4回以上支給 → 報酬。7月2日以降の変更は、次の定時決定（9月）まで扱いを変えない
 * - 同 1(2)：性質ごとに数える／例外的な分割はまとめて1回／当該年に限りの支給は数えない
 * - 同 2(1)：額は7月1日前の1年間に受けた額 ÷ 12。規程の回数を変えて新たに報酬になったときは「受けたであろう額」÷ 12
 * - 同 2(2)：資格取得時は、同様の業務・同様の賞与を受ける者の平均
 * - 課長通知 1(3)・令和5年 Q&A Q4：新しく作った規程の賞与は、次の定時決定までは賞与（賞与支払届を出す）
 *
 * 期間：2026年の定時決定（W2026 ＝ 2025-07-01〜2026-06-30 の実績。2026年9月〜2027年8月の支給に効く）
 */
import { BonusTreatmentPeriod } from '../../../core/models/bonus-item';
import { resolveItems, withTreatment } from './bonus-items';
import { acquireBonusRemunerationOf, bonusRemunerationOf, BonusCountAs, isRemunerationBonus } from './bonus-nature';

type Pay = { id: string; paidDate: string; amounts: Record<string, number>; nature: string; countAs?: BonusCountAs };
let n = 0;
const pay = (paidDate: string, who: string[], nature = 'Q', amount = 100000, countAs?: BonusCountAs): Pay => ({
  id: `p${n++}`,
  paidDate,
  amounts: Object.fromEntries(who.map((w) => [w, amount])),
  nature,
  ...(countAs ? { countAs } : {}),
});
const item = (treatments: BonusTreatmentPeriod[], plannedCount: number | null = null) => [
  { name: 'Q', labels: [], plannedCount, treatments },
];
const COUNT = [{ fromYear: 0, treatment: 'count' as const }];
const REMU = [{ fromYear: 0, treatment: 'remuneration' as const }];
/** その支給は、その人にとって報酬か */
const remu = (pays: ReturnType<typeof resolveItems<Pay>>, date: string, who = 'A') =>
  isRemunerationBonus(who, pays.find((p) => p.paidDate === date)!, pays);

describe('ケース1：前年に4回、今年も同じく4回（規程どおり続く）', () => {
  const raw = [
    pay('2024-09-30', ['A']), pay('2024-12-26', ['A']), pay('2025-03-31', ['A']), pay('2025-06-30', ['A']),
    pay('2025-09-30', ['A']), pay('2025-12-26', ['A']), pay('2026-03-31', ['A']), pay('2026-06-30', ['A']),
    pay('2026-09-30', ['A']),
  ];
  for (const [label, t] of [['回数で判定', COUNT], ['年4回以上の賞与', REMU]] as const) {
    it(`${label}：9月からの支給は報酬。定時決定で1年分 ÷ 12 を足す（見込みにしない）`, () => {
      const pays = resolveItems(raw, item([...t], 4), '賞与');
      expect(remu(pays, '2025-09-30')).toBe(true);
      expect(remu(pays, '2026-09-30')).toBe(true);
      const r = bonusRemunerationOf('A', 2026, pays);
      expect(r.annual).toBe(400000);
      expect(r.monthly).toBe(33333);
      expect(r.natures[0].estimated ?? false).toBe(false);
    });
  }
});

describe('ケース2：前年に4回、今年から3回に減らした', () => {
  const raw = [
    pay('2024-09-30', ['A']), pay('2024-12-26', ['A']), pay('2025-03-31', ['A']), pay('2025-06-30', ['A']),
    pay('2025-12-26', ['A']), pay('2026-03-31', ['A']), pay('2026-06-30', ['A']),
    pay('2026-12-26', ['A']),
  ];
  it('2026年8月までは前の定時決定のまま報酬。9月からは賞与（7月1日前の1年は3回）', () => {
    const pays = resolveItems(raw, item(COUNT), '賞与');
    expect(remu(pays, '2025-12-26')).toBe(true);
    expect(remu(pays, '2026-06-30')).toBe(true);
    expect(remu(pays, '2026-12-26')).toBe(false);
    expect(bonusRemunerationOf('A', 2026, pays).annual).toBe(0);
  });
  it('「年4回以上の賞与」で登録していた項目を「回数で判定」に戻した（使っているので次の定時決定から）', () => {
    const t = withTreatment(REMU, 'count', true, '2025-11-01');
    expect(t).toEqual([{ fromYear: 0, treatment: 'remuneration' }, { fromYear: 2026, treatment: 'count' }]);
    const pays = resolveItems(raw, item(t, 3), '賞与');
    expect(remu(pays, '2026-06-30')).toBe(true); // 2025年の定時決定のまま
    expect(remu(pays, '2026-12-26')).toBe(false);
  });
});

describe('ケース3：前年に3回だった支給を、規程を変えて4回に（2025年10月に変更）', () => {
  const t = withTreatment(COUNT, 'remuneration', true, '2025-10-01');
  it('変えた日から次の定時決定（2026年9月）までは賞与。9月からは報酬', () => {
    expect(t).toEqual([{ fromYear: 0, treatment: 'count' }, { fromYear: 2026, treatment: 'remuneration' }]);
    const raw = [
      pay('2024-12-26', ['A']), pay('2025-03-31', ['A']), pay('2025-06-30', ['A']),
      pay('2025-12-26', ['A']), pay('2026-03-31', ['A']), pay('2026-06-30', ['A']),
      pay('2026-09-30', ['A']),
    ];
    const pays = resolveItems(raw, item(t, 4), '賞与');
    expect(remu(pays, '2025-12-26')).toBe(false);
    expect(remu(pays, '2026-06-30')).toBe(false);
    expect(remu(pays, '2026-09-30')).toBe(true);
  });
  it('定時決定：新しい規程で受けたであろう額（実績3回 → 平均 × 4回）', () => {
    const raw = [pay('2025-12-26', ['A']), pay('2026-03-31', ['A']), pay('2026-06-30', ['A'])];
    const r = bonusRemunerationOf('A', 2026, resolveItems(raw, item(t, 4), '賞与'));
    expect(r.natures[0].estimated).toBe(true);
    expect(r.annual).toBe(400000);
  });
  it('項目を新しく作って、すぐ「年4回以上の賞与」にした（まだ使っていない）：それでも次の定時決定までは賞与（Q&A Q4）', () => {
    const fresh = withTreatment([], 'remuneration', false, '2025-10-01');
    const pays = resolveItems([pay('2025-12-26', ['A']), pay('2026-09-30', ['A'])], item(fresh, 4), '賞与');
    expect(remu(pays, '2025-12-26')).toBe(false);
    expect(remu(pays, '2026-09-30')).toBe(true);
  });
});

describe('ケース4：前年は3回、今年は予定外にもう1回（同じ性質）', () => {
  const base = [
    pay('2024-07-10', ['A']), pay('2024-12-10', ['A']), pay('2025-03-31', ['A']),
    pay('2025-07-10', ['A']), pay('2025-12-10', ['A']), pay('2026-03-31', ['A']),
  ];
  it('ふつうに数える支給なら、7月1日前の1年で4回 → 9月から報酬。その年の4回は賞与のまま（さかのぼらない）', () => {
    const pays = resolveItems([...base, pay('2026-02-27', ['A']), pay('2026-12-10', ['A'])], item(COUNT), '賞与');
    expect(remu(pays, '2026-02-27')).toBe(false);
    expect(remu(pays, '2026-12-10')).toBe(true);
    expect(bonusRemunerationOf('A', 2026, pays).annual).toBe(400000);
  });
  it('その年に限りの支給なら数えない → 賞与のまま', () => {
    const pays = resolveItems([...base, pay('2026-02-27', ['A'], 'Q', 100000, 'oneOff'), pay('2026-12-10', ['A'])], item(COUNT), '賞与');
    expect(remu(pays, '2026-12-10')).toBe(false);
  });
  it('例外的な分割なら1回 → 賞与のまま', () => {
    const pays = resolveItems([...base, pay('2026-04-10', ['A'], 'Q', 100000, 'split'), pay('2026-12-10', ['A'])], item(COUNT), '賞与');
    expect(remu(pays, '2026-12-10')).toBe(false);
  });
});

describe('ケース5：同じ支給でも、人によって回数が違う（A 3回・B 5回・D 2回）', () => {
  const raw = [
    pay('2025-08-10', ['A', 'B', 'C']), pay('2025-11-10', ['A', 'B', 'C']), pay('2026-02-10', ['A', 'B', 'C']),
    pay('2026-04-10', ['B', 'C', 'D']), pay('2026-06-10', ['B', 'C', 'D']),
    pay('2026-10-10', ['A', 'B', 'C', 'D']),
  ];
  it('回数で判定：人ごとに数える（B・C だけ報酬）', () => {
    const pays = resolveItems(raw, item(COUNT), '賞与');
    expect(['A', 'B', 'C', 'D'].map((w) => remu(pays, '2026-10-10', w))).toEqual([false, true, true, false]);
  });
  it('年4回以上の賞与（規程）：規程なので、回数に関係なく全員が報酬', () => {
    const pays = resolveItems(raw, item(REMU, 4), '賞与');
    expect(['A', 'B', 'C', 'D'].map((w) => remu(pays, '2026-10-10', w))).toEqual([true, true, true, true]);
  });
});

describe('ケース6：規程で年4回以上の支給がずっと続いている会社に、途中で入った人', () => {
  it('次の定時決定は、実際に受けた額 ÷ 12（受けたであろう額にしない。局部長通知 2(1)ア）', () => {
    const raw = [pay('2026-03-31', ['D']), pay('2026-06-30', ['D'])];
    const r = bonusRemunerationOf('D', 2026, resolveItems(raw, item(REMU, 4), '賞与'));
    expect(r.natures[0].estimated ?? false).toBe(false);
    expect(r.annual).toBe(200000);
  });
});

describe('ケース7：賞与に係る報酬がある会社に、新しく入った人の資格取得（局部長通知 2(2)）', () => {
  const emp = (id: string, acquired: string) => ({ id, health: { acquiredDate: acquired }, pension: { acquiredDate: acquired } });
  const raw = [
    pay('2025-09-30', ['A', 'B']), pay('2025-12-26', ['A', 'B']), pay('2026-03-31', ['A', 'B']), pay('2026-06-30', ['A', 'B'], 'Q', 220000),
  ];
  const pays = resolveItems(raw, item(REMU, 4), '賞与');
  const others = [emp('A', '2020-04-01'), emp('B', '2020-04-01'), emp('C', '2020-04-01')];
  it('9月からの入社：その年の定時決定で報酬になっている人（本人以外）の平均を、報酬月額に足す', () => {
    const r = acquireBonusRemunerationOf('N', '2026-10-01', others, pays);
    // A・B とも (100,000 × 3 + 220,000) ÷ 12 ＝ 43,333。C は受けていないので平均に入れない
    expect(r).toEqual({ monthly: 43333, people: 2, natures: ['Q'] });
  });
  it('賞与に係る報酬がない会社では、何も足さない', () => {
    const plain = resolveItems(raw.slice(0, 2), item(COUNT), '賞与');
    expect(acquireBonusRemunerationOf('N', '2026-10-01', others, plain)).toBeNull();
  });
});
