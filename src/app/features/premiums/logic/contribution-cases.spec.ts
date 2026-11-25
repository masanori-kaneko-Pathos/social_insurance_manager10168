/**
 * 子ども・子育て拠出金を、外の正解で確かめる（11/25）
 * 出典 I：子ども・子育て支援法 70条1項（拠出金の額）：厚生年金保険の保険料の計算の基礎となる標準報酬月額・標準賞与額
 *   （産休・育休で厚生年金保険料を徴収しない被用者の分を除く）× 拠出金率
 * 出典 J：日本年金機構「厚生年金保険料額表」の注記：拠出金率 0.36%（令和2年4月分〜）、事業主が全額負担、
 *   標準賞与額は厚生年金保険と拠出金とも1か月150万円が上限
 */
import { MasterRateDoc } from '../../../core/models/rates';
import { CoverageInput } from '../../employees/logic/coverage';
import { pickRates } from '../../rates/logic/pick-rates';
import { calcBonuses } from './calc-bonus';
import { calcMonthly, RemunerationLike } from './calc-monthly';

const MASTER: MasterRateDoc[] = [
  { kind: 'kyokaiHealth', from: '2026-03', byPrefecture: { '13': 98500 }, source: 'test' },
  { kind: 'care', from: '2026-03', rate: 16200, source: 'test' },
  { kind: 'childSupport', from: '2026-04', rate: 2300, source: 'test' },
  { kind: 'pension', from: '2024-03', rate: 183000, source: 'test' },
  { kind: 'childContribution', from: '2024-03', rate: 3600, source: 'test' },
];
const rates = (month: string) => pickRates({ prefecture: '13', healthInsurer: { type: 'kyokai' } }, { master: MASTER, kumiai: [] }, month);
const rem: RemunerationLike = { from: '2024-09', health: { grade: 22, standard: 300000 }, pension: { grade: 19, standard: 300000 } } as RemunerationLike;
const person = (birthDate: string, x: object = {}): CoverageInput => ({
  birthDate,
  health: { enrolled: true, acquiredDate: '2020-04-01', lostDate: null },
  pension: { enrolled: true, acquiredDate: '2020-04-01', lostDate: null },
  ...x,
});
const contribution = (r: ReturnType<typeof calcMonthly>) =>
  r.groups.flatMap((g) => g.lines).find((l) => l.part === 'childContribution');
const month = (employee: CoverageInput, m = '2026-11') => calcMonthly({ month: m, employee, remunerations: [rem], rates: rates(m) });

describe('出典I・J 子ども・子育て拠出金', () => {
  it('厚年の標準報酬月額 300,000円 × 0.36% ＝ 1,080円。事業主が全額負担（本人負担 0円）', () => {
    const r = month(person('1990-05-15'));
    expect(contribution(r)!.totalMilli).toBe(1080000);
    expect(r.groups.find((g) => g.parts.includes('childContribution'))!.employeeYen).toBe(0);
  });
  it('産休・育休で厚生年金保険料を徴収しない月は、拠出金もかからない（70条1項のかっこ書き）', () => {
    const leave = { kind: 'childcare', start: '2026-10-01', end: '2027-03-31', plannedEnd: null, filed: { filedOn: '2026-09-20' } };
    const r = month(person('1990-05-15', { leaves: [leave] }));
    expect([r.exempt, contribution(r)]).toEqual([true, undefined]);
  });
  it('厚生年金保険料がかからない70歳以上は、拠出金もかからない（厚年の保険料の計算の基礎がない）', () => {
    const r = month(person('1955-05-15', { pension: { enrolled: true, acquiredDate: '2020-04-01', lostDate: '2025-05-14' } }));
    expect(contribution(r)).toBeUndefined();
  });
  it('賞与：標準賞与額は厚年と同じく1か月150万円が上限 → 200万円の賞与でも 150万円 × 0.36% ＝ 5,400円', () => {
    const [b] = calcBonuses({ employee: person('1990-05-15'), bonuses: [{ paidDate: '2026-12-10', amount: 2000000 }], ratesFor: rates });
    const line = b.groups.flatMap((g) => g.lines).find((l) => l.part === 'childContribution')!;
    expect(line.totalMilli).toBe(5400000);
  });
});
