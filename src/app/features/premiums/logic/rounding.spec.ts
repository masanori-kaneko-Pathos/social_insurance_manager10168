import { floorYen, formatMilli, milliOf, roundEmployee } from './rounding';

describe('roundEmployee：本人負担の端数処理（日本年金機構の例）', () => {
  it('給与控除：50銭以下は切り捨て、50銭を超えたら切り上げ', () => {
    expect(roundEmployee(12345500, 'payroll')).toBe(12345); // 12,345.50円
    expect(roundEmployee(12345510, 'payroll')).toBe(12346); // 12,345.51円
    expect(roundEmployee(12345501, 'payroll')).toBe(12346); // 12,345.501円（50銭をわずかに超える）
  });

  it('現金払い：50銭未満は切り捨て、50銭以上は切り上げ', () => {
    expect(roundEmployee(12345490, 'cash')).toBe(12345); // 12,345.49円
    expect(roundEmployee(12345500, 'cash')).toBe(12346); // 12,345.50円
  });

  it('端数がなければそのまま、0円は0円', () => {
    expect(roundEmployee(12345000, 'payroll')).toBe(12345);
    expect(roundEmployee(12345000, 'cash')).toBe(12345);
    expect(roundEmployee(0, 'payroll')).toBe(0);
  });

  it('年金機構の例：A さん 9,221.30円 → 9,221円、C さん 12,574.50円 → 12,574円', () => {
    expect(roundEmployee(9221300, 'payroll')).toBe(9221);
    expect(roundEmployee(12574500, 'payroll')).toBe(12574);
  });

  it('負の数・小数はエラーで止まる', () => {
    expect(() => roundEmployee(-1, 'payroll')).toThrowError(/本人負担/);
    expect(() => roundEmployee(1.5, 'payroll')).toThrowError(/本人負担/);
  });
});

describe('milliOf：金額 × 料率（割り算なし）', () => {
  it('佐賀1級 58,000円 × 10.55% ＝ 6,119円（小数だと 3,059.5000000000005 になるケース）', () => {
    expect(milliOf(58000, 105500)).toBe(6119000);
    expect(milliOf(58000, 52750)).toBe(3059500); // 折半 3,059.5円
    expect(roundEmployee(milliOf(58000, 52750), 'payroll')).toBe(3059);
  });

  it('1,000円単位でない金額はエラーで止まる', () => {
    expect(() => milliOf(58500, 100000)).toThrowError(/1,000円単位/);
  });
});

describe('floorYen / formatMilli', () => {
  it('年金機構の例：合計 122,056.48円 → 納付額 122,056円', () => {
    expect(floorYen(122056480)).toBe(122056);
  });

  it('表示は小数の余分な0を消す', () => {
    expect(formatMilli(29550400)).toBe('29,550.4');
    expect(formatMilli(29550000)).toBe('29,550');
    expect(formatMilli(3059500)).toBe('3,059.5');
    expect(formatMilli(66700)).toBe('66.7');
  });
});
