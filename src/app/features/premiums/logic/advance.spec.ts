import { advanceAmount, advanceState } from './advance';

describe('advance：保険料の立替', () => {
  it('給与（通貨）が本人負担より少なければ立替', () => {
    expect(advanceState({ cash: 0 }, 41000)).toBe('needed'); // 休職で無給
    expect(advanceState({ cash: 30000 }, 41000)).toBe('needed');
    expect(advanceAmount({ cash: 30000 }, 41000)).toBe(11000);
  });
  it('控除できる・実績がない・本人負担がない', () => {
    expect(advanceState({ cash: 41000 }, 41000)).toBe('none');
    expect(advanceState(null, 41000)).toBe('unknown');
    expect(advanceState(null, 0)).toBe('none'); // 産休・育休の免除
  });
});
