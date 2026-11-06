import { MasterRateDoc } from '../../../core/models/rates';
import { CoverageInput } from '../../employees/logic/coverage';
import { pickRates } from '../../rates/logic/pick-rates';
import { EmployeeBonus, bonusStatus, calcBonuses, standardBonusOf } from './calc-bonus';

const MASTER: MasterRateDoc[] = [
  {
    kind: 'kyokaiHealth',
    from: '2025-03',
    byPrefecture: { '13': 99100, '41': 107800 },
    source: 'test',
  },
  {
    kind: 'kyokaiHealth',
    from: '2026-03',
    byPrefecture: { '13': 98500, '41': 105500 },
    source: 'test',
  },
  { kind: 'care', from: '2025-03', rate: 15900, source: 'test' },
  { kind: 'care', from: '2026-03', rate: 16200, source: 'test' },
  { kind: 'childSupport', from: '2024-03', rate: 0, source: 'test' },
  { kind: 'childSupport', from: '2026-04', rate: 2300, source: 'test' },
  { kind: 'pension', from: '2024-03', rate: 183000, source: 'test' },
  { kind: 'childContribution', from: '2024-03', rate: 3600, source: 'test' },
];

const ratesFor = (prefecture: string) => (month: string) =>
  pickRates(
    { prefecture, healthInsurer: { type: 'kyokai' } },
    { master: MASTER, kumiai: [] },
    month,
  );

const person = (
  birthDate: string,
  acquiredDate: string,
  lostDate: string | null = null,
): CoverageInput => ({
  birthDate,
  health: { enrolled: true, acquiredDate, lostDate },
  pension: { enrolled: true, acquiredDate, lostDate },
});

const AGE30 = person('1996-05-15', '2024-04-01');
const calc = (employee: CoverageInput, bonuses: EmployeeBonus[], pref = '13') =>
  calcBonuses({ employee, bonuses, ratesFor: ratesFor(pref) });

describe('standardBonusOf：1,000円未満を切り捨て', () => {
  it('1,234,567円 → 1,234,000円', () => {
    expect(standardBonusOf(1234567)).toBe(1234000);
    expect(standardBonusOf(999)).toBe(0);
  });
});

describe('calcBonuses：普通の賞与', () => {
  it('東京・30歳・50万円：健保＋支援金 25,200円、厚年 45,750円、拠出金は会社だけ 1,800円', () => {
    const [r] = calc(AGE30, [{ paidDate: '2026-12-10', amount: 500000 }]);
    expect(r.standardBonus).toBe(500000);
    expect(r.groups[0].parts).toEqual(['health', 'childSupport']);
    expect(r.groups[0].totalMilli).toBe(50400000); // 500,000 × (9.85% ＋ 0.23%)
    expect(r.groups[0].employeeYen).toBe(25200);
    expect(r.groups[1].employeeYen).toBe(45750);
    expect(r.groups[2].employerMilli).toBe(1800000);
  });

  it('端数が出る賞与：佐賀・333,456円 → 標準賞与額 333,000円、健保＋支援金 17,948.7円 → 17,949円', () => {
    const [r] = calc(AGE30, [{ paidDate: '2026-12-10', amount: 333456 }], '41');
    expect(r.standardBonus).toBe(333000);
    expect(r.groups[0].totalMilli).toBe(35897400); // 333,000 × 10.78%
    expect(r.groups[0].employeeYen).toBe(17949);
  });

  it('介護は、支払った月が 40歳到達月〜65歳到達月の前月 のときだけ', () => {
    const p = person('1986-12-01', '2024-04-01'); // 40歳到達日 2026-11-30 → 11月から
    const [oct, nov] = calc(p, [
      { paidDate: '2026-10-30', amount: 500000 },
      { paidDate: '2026-11-05', amount: 500000 },
    ]);
    expect(oct.groups[0].parts).toEqual(['health', 'childSupport']);
    expect(nov.groups[0].parts).toEqual(['health', 'care', 'childSupport']);
  });
});

describe('calcBonuses：上限', () => {
  it('健保は年度の累計573万円まで（年度が変わったらリセット）', () => {
    const rs = calc(AGE30, [
      { paidDate: '2027-03-25', amount: 1000000 },
      { paidDate: '2026-06-30', amount: 3000000 }, // 順番がばらばらでも支払日順に計算する
      { paidDate: '2026-12-10', amount: 2500000 },
      { paidDate: '2027-06-30', amount: 1000000 }, // 2027年度
    ]);
    expect(rs.map((r) => r.paidDate)).toEqual([
      '2026-06-30',
      '2026-12-10',
      '2027-03-25',
      '2027-06-30',
    ]);
    expect(rs.map((r) => r.healthBase)).toEqual([3000000, 2500000, 230000, 1000000]);
  });

  it('厚年は1回150万円まで', () => {
    const [r] = calc(AGE30, [{ paidDate: '2026-12-10', amount: 2000000 }]);
    expect(r.pensionBase).toBe(1500000);
    expect(r.healthBase).toBe(2000000);
  });

  it('厚年は同じ月の合計で150万円まで（2回目は残りの50万円だけ）', () => {
    const [first, second] = calc(AGE30, [
      { paidDate: '2026-12-05', amount: 1000000 },
      { paidDate: '2026-12-25', amount: 800000 },
    ]);
    expect(first.pensionBase).toBe(1000000);
    expect(second.pensionBase).toBe(500000);
  });

  it('上限に達した後の賞与は、健保の保険料が0円', () => {
    const rs = calc(AGE30, [
      { paidDate: '2026-06-30', amount: 6000000 },
      { paidDate: '2026-12-10', amount: 500000 },
    ]);
    expect(rs[0].healthBase).toBe(5730000);
    expect(rs[1].healthBase).toBe(0);
    expect(rs[1].groups[0].totalMilli).toBe(0);
  });
});

describe('calcBonuses：支払日による例外', () => {
  it('月の途中で退職（12/20退職・喪失日12/21）：12/10の賞与は保険料なし、健保の累計には入る', () => {
    const [r] = calc(person('1996-05-15', '2024-04-01', '2026-12-21'), [
      { paidDate: '2026-12-10', amount: 500000 },
    ]);
    expect(r.healthStatus).toBe('counted');
    expect(r.pensionStatus).toBe('none');
    expect(r.groups).toEqual([]);
    expect(r.healthBase).toBe(500000);
  });

  it('月末で退職（12/31退職・喪失日1/1）：12/25の賞与は保険料がかかる', () => {
    const [r] = calc(person('1996-05-15', '2024-04-01', '2027-01-01'), [
      { paidDate: '2026-12-25', amount: 500000 },
    ]);
    expect(r.healthStatus).toBe('charged');
    expect(r.pensionStatus).toBe('charged');
  });

  it('退職後（喪失日以降）に払った賞与は対象外（累計にも入らない）', () => {
    const [r] = calc(person('1996-05-15', '2024-04-01', '2026-12-21'), [
      { paidDate: '2026-12-25', amount: 500000 },
    ]);
    expect(r.healthStatus).toBe('none');
    expect(r.healthBase).toBe(0);
  });

  it('資格取得月：取得日より前に払った賞与は対象外、取得日以降はかかる', () => {
    expect(bonusStatus(true, '2026-06-10', null, '2026-06-05')).toBe('none');
    expect(bonusStatus(true, '2026-06-10', null, '2026-06-10')).toBe('charged');
  });

  it('同月得喪（6/10取得・6/26喪失）：6/20の賞与はかかる、6/27の賞与は対象外', () => {
    expect(bonusStatus(true, '2026-06-10', '2026-06-26', '2026-06-20')).toBe('charged');
    expect(bonusStatus(true, '2026-06-10', '2026-06-26', '2026-06-27')).toBe('none');
  });

  it('加入していなければ対象外', () => {
    expect(bonusStatus(false, '2026-06-10', null, '2026-06-20')).toBe('none');
  });

  it('70歳到達月（8/1生まれ・到達日7/31）：7月の賞与は厚年なし・健保あり、6月の賞与は両方', () => {
    const p = person('1956-08-01', '2018-04-01');
    const [jun, jul] = calc(p, [
      { paidDate: '2026-06-30', amount: 500000 },
      { paidDate: '2026-07-10', amount: 500000 },
    ]);
    expect(jun.pensionStatus).toBe('charged');
    expect(jul.pensionStatus).toBe('none');
    expect(jul.healthStatus).toBe('charged');
  });
});
