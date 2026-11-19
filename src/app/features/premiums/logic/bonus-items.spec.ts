import { nextDecisionYear, parseLabels, resolveItems, treatmentAt, validateItem, withRename, withTreatment } from './bonus-items';
import { bonusRemunerationOf, isNotCovered, isRemunerationBonus } from './bonus-nature';

const item = (name: string, labels: string[], treatment: 'count' | 'remuneration' | 'none', plannedCount: number | null = null) => ({
  name, labels, plannedCount, treatments: [{ fromYear: 0, treatment }],
});

describe('賞与の項目（11/19）', () => {
  it('取り込みの名前・項目の名前で項目に当てる。当たらない名前はそのまま', () => {
    const items = [item('賞与', ['夏季賞与', '冬季賞与'], 'count')];
    const r = resolveItems([{ nature: '夏季賞与' }, { nature: null }, { nature: '決算賞与' }], items, '賞与');
    expect(r.map((p) => p.group ?? null)).toEqual(['賞与', '賞与', null]);
  });

  it('扱いは定時決定の年ごと。変えたら次の7月1日の年から', () => {
    expect(nextDecisionYear('2026-11-19')).toBe(2027);
    expect(nextDecisionYear('2026-06-30')).toBe(2026);
    const t = withTreatment([{ fromYear: 0, treatment: 'count' }], 'remuneration', true, '2026-11-19');
    expect(t).toEqual([{ fromYear: 0, treatment: 'count' }, { fromYear: 2027, treatment: 'remuneration' }]);
    expect(treatmentAt({ treatments: t }, 2026)).toBe('count');
    expect(treatmentAt({ treatments: t }, 2027)).toBe('remuneration');
    // まだ使っていなければ最初から
    expect(withTreatment(t, 'none', false, '2026-11-19')).toEqual([{ fromYear: 0, treatment: 'none' }]);
    // 同じ年にもう一度変えたら上書き、元に戻したら足さない
    expect(withTreatment(t, 'count', true, '2026-11-20')).toEqual([{ fromYear: 0, treatment: 'count' }]);
  });

  it('名前を変えたら、古い名前を取り込みの名前に足す', () => {
    const r = withRename(item('四半期', [], 'count'), item('四半期インセンティブ', [], 'count'));
    expect(r.labels).toEqual(['四半期']);
  });

  it('名前・取り込みの名前は、ほかの項目と重ならない。規程の回数は1〜12', () => {
    const others = [item('賞与', ['夏季賞与'], 'count')];
    expect(validateItem(item('決算賞与', ['夏季賞与'], 'count'), others)).toEqual(['duplicate']);
    expect(validateItem(item('', [], 'count', 13), [])).toEqual(['nameRequired', 'plannedCount']);
    expect(parseLabels('夏季賞与、冬季賞与,夏季賞与\n 賞与 ', '賞与')).toEqual(['夏季賞与', '冬季賞与']);
  });

  it('対象外の項目は、賞与でも報酬でもない', () => {
    const [p] = resolveItems([{ id: 'a', paidDate: '2026-10-10', amounts: { e1: 30000 }, nature: '永年勤続表彰' }], [item('祝い金', ['永年勤続表彰'], 'none')], '賞与');
    expect(isNotCovered(p)).toBe(true);
    expect(isRemunerationBonus('e1', p, [p])).toBe(false);
  });

  it('年4回以上の賞与：規程を変えた年は、平均 × 規程の回数を見込みにする（規程がずっと続く項目・途中入社は実績。bonus-scenarios.spec）', () => {
    const items = [{ name: '四半期インセンティブ', labels: [], plannedCount: 4, treatments: [{ fromYear: 0, treatment: 'count' as const }, { fromYear: 2026, treatment: 'remuneration' as const }] }];
    const pays = resolveItems(
      [
        { id: 'a', paidDate: '2025-09-30', amounts: { e1: 60000 }, nature: '四半期インセンティブ' },
        { id: 'b', paidDate: '2025-12-26', amounts: { e1: 90000 }, nature: '四半期インセンティブ' },
        { id: 'c', paidDate: '2026-09-30', amounts: { e1: 75000 }, nature: '四半期インセンティブ' },
      ],
      items,
      '賞与',
    );
    expect(isRemunerationBonus('e1', pays[0], pays)).toBe(false); // 次の定時決定までは賞与
    expect(isRemunerationBonus('e1', pays[2], pays)).toBe(true);
    const r = bonusRemunerationOf('e1', 2026, pays);
    expect(r.natures[0].estimated).toBe(true);
    expect(r.annual).toBe(300000); // (60,000 + 90,000) ÷ 2回 × 4回
    expect(r.monthly).toBe(25000);
  });
});
