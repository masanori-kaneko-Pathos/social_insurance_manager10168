/**
 * 賞与の標準賞与額・上限・対象になる賞与を、外の正解で確かめる（11/25）
 * 出典 H：日本年金機構「賞与支払届」の説明 3．標準賞与額・4．留意事項（6）〜（12）
 */
import { MasterRateDoc } from '../../../core/models/rates';
import { pickRates } from '../../rates/logic/pick-rates';
import { calcBonuses, EmployeeBonus, standardBonusOf } from './calc-bonus';

const MASTER: MasterRateDoc[] = [
  { kind: 'kyokaiHealth', from: '2026-03', byPrefecture: { '13': 98500 }, source: 'test' },
  { kind: 'care', from: '2026-03', rate: 16200, source: 'test' },
  { kind: 'childSupport', from: '2026-04', rate: 2300, source: 'test' },
  { kind: 'pension', from: '2024-03', rate: 183000, source: 'test' },
  { kind: 'childContribution', from: '2024-03', rate: 3600, source: 'test' },
];
const ratesFor = (month: string) => pickRates({ prefecture: '13', healthInsurer: { type: 'kyokai' } }, { master: MASTER, kumiai: [] }, month);
type Emp = Parameters<typeof calcBonuses>[0]['employee'];
const emp = (acquiredDate: string, lostDate: string | null = null, x: Partial<Emp> = {}): Emp => ({
  birthDate: '1990-05-15',
  health: { enrolled: true, acquiredDate, lostDate },
  pension: { enrolled: true, acquiredDate, lostDate },
  ...x,
});
const calc = (e: Emp, bonuses: EmployeeBonus[]) => calcBonuses({ employee: e, bonuses, ratesFor });

describe('出典H 3．標準賞与額', () => {
  it('税引き前の賞与の額から1千円未満を切り捨てる', () => {
    expect(standardBonusOf(1234567)).toBe(1234000);
  });
  it('厚年は支給1回につき150万円が上限（同じ月の2回は合算して150万円）', () => {
    expect(calc(emp('2024-04-01'), [{ paidDate: '2026-12-10', amount: 2000000 }])[0].pensionBase).toBe(1500000);
    const two = calc(emp('2024-04-01'), [{ paidDate: '2026-12-05', amount: 1000000 }, { paidDate: '2026-12-25', amount: 800000 }]);
    expect(two[0].pensionBase + two[1].pensionBase).toBe(1500000);
  });
});

describe('出典H 4．留意事項', () => {
  it('（6）資格取得日以降の取得月の賞与はかかる。喪失月の賞与はかからない', () => {
    const joined = calc(emp('2026-12-05'), [{ paidDate: '2026-12-10', amount: 300000 }]);
    expect([joined[0].healthStatus, joined[0].pensionStatus]).toEqual(['charged', 'charged']);
    const left = calc(emp('2024-04-01', '2026-12-21'), [{ paidDate: '2026-12-10', amount: 300000 }]);
    expect(left[0].pensionStatus).toBe('none');
  });
  it('（6）同じ月に取得と喪失：取得日から喪失日の前日までに払った賞与はかかる', () => {
    const r = calc(emp('2026-06-10', '2026-06-26'), [{ paidDate: '2026-06-20', amount: 300000 }, { paidDate: '2026-06-27', amount: 300000 }]);
    expect(r.map((x) => x.pensionStatus)).toEqual(['charged', 'none']);
  });
  it('（7）健保：喪失月でも喪失日の前日までの賞与は標準賞与額を決め、年度の累計（573万円）に入れる', () => {
    const r = calc(emp('2024-04-01', '2027-03-21'), [{ paidDate: '2026-07-10', amount: 3000000 }, { paidDate: '2027-03-10', amount: 3000000 }]);
    expect(r[1].healthStatus).toBe('counted');
    expect(r[1].healthBase).toBe(2730000); // 573万 − 300万
  });
  it('（8）育休で免除の期間に払った賞与も、標準賞与額を決めて年度の累計に入れる', () => {
    const leave = { kind: 'childcare' as const, start: '2026-06-01', end: '2026-08-31', plannedEnd: null, filed: { filedOn: '2026-05-20' } };
    const r = calc(emp('2024-04-01', null, { leaves: [leave] } as Partial<Emp>), [
      { paidDate: '2026-07-10', amount: 4000000 }, // 免除
      { paidDate: '2026-12-10', amount: 3000000 },
    ]);
    expect([r[0].exempt, r[0].totalMilli, r[0].standardBonus, r[0].healthBase]).toEqual([true, 0, 4000000, 4000000]);
    expect(r[1].healthBase).toBe(1730000); // 573万 − 400万（免除の分も累計に入る）
  });
  it('（11）年度の累計が573万円を超えたら573万円になるよう決め、その後の賞与は0', () => {
    const r = calc(emp('2024-04-01'), [{ paidDate: '2026-07-10', amount: 4000000 }, { paidDate: '2026-12-10', amount: 3000000 }, { paidDate: '2027-03-10', amount: 500000 }]);
    expect(r.map((x) => x.healthBase)).toEqual([4000000, 1730000, 0]);
  });
  it('（10）累計は保険者ごと：同じ年度に協会けんぽから組合健保へ移ったら数え直す', () => {
    const r = calcBonuses({
      employee: emp('2024-04-01'),
      bonuses: [{ paidDate: '2026-07-10', amount: 4000000 }, { paidDate: '2026-12-10', amount: 4000000 }],
      ratesFor,
      insurerOf: (m) => (m >= '2026-10' ? 'kumiai:2026-10' : 'kyokai'),
    });
    expect(r.map((x) => x.healthBase)).toEqual([4000000, 4000000]);
  });
  it('（12）同じ月に2回払ったら合算する（1,000円未満は合計で切り捨て）', () => {
    const r = calc(emp('2024-04-01'), [{ paidDate: '2026-12-05', amount: 100500 }, { paidDate: '2026-12-25', amount: 200700 }]);
    expect(r[0].standardBonus + r[1].standardBonus).toBe(301000);
  });
});
