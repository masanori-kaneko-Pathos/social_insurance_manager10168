import { addYears, deletableOn, retentionBase, retentionCandidate } from './retention';

describe('退職した人のデータの保存期間（11/27）', () => {
  it('数え始める日は、退職日・最後の給与の月末・最後の賞与の支払日のうち遅い日（施行規則56条）', () => {
    // 3月31日退職、最後の給与は4月払い → 4月30日から
    expect(retentionBase({ retireDate: '2021-03-31', lastPaidMonth: '2021-04', lastBonusDate: '2020-12-10' })).toBe('2021-04-30');
    expect(retentionBase({ retireDate: '2021-03-31', lastPaidMonth: '2021-02', lastBonusDate: null })).toBe('2021-03-31');
    expect(retentionBase({ retireDate: '2021-06-30', lastPaidMonth: '2021-06', lastBonusDate: '2021-07-10' })).toBe('2021-07-10');
  });

  it('5年たった次の日から消せる。退職していなければ消せない', () => {
    expect(deletableOn({ retireDate: '2021-03-31', lastPaidMonth: '2021-04', lastBonusDate: null })).toBe('2026-05-01');
    expect(deletableOn({ retireDate: null, lastPaidMonth: '2021-04', lastBonusDate: null })).toBeNull();
  });

  it('2月29日の5年後は2月28日', () => {
    expect(addYears('2024-02-29', 5)).toBe('2029-02-28');
  });

  it('To-do は退職日だけで見る', () => {
    expect(retentionCandidate('2021-03-31', '2026-04-01')).toBeTrue();
    expect(retentionCandidate('2021-03-31', '2026-03-31')).toBeFalse();
    expect(retentionCandidate(null, '2030-01-01')).toBeFalse();
  });
});
