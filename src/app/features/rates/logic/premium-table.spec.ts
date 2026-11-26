import type { GradeRow, PickedRate, RatesForMonth } from '../../../core/models/rates';
import { EXCEL_TOKYO } from '../../premiums/logic/excel-r8.fixture';
import { HEALTH_ROWS, PENSION_ROWS } from '../../payrolls/logic/grades.fixture';
import { isHalf, premiumTable } from './premium-table';

const half = (total: number, source: PickedRate['source'] = 'kyokai'): PickedRate => ({
  employee: total / 2,
  employer: total / 2,
  from: '2026-03',
  source,
});
// 東京・令和8年3月分（健保 9.85%・介護 1.62%・支援金 0.23%・厚年 18.3%）
const TOKYO: RatesForMonth = {
  month: '2026-04',
  health: half(98500),
  care: half(16200, 'national'),
  childSupport: half(2300, 'national'),
  pension: half(183000, 'national'),
  childContribution: { employee: 0, employer: 3600, from: '2026-04', source: 'national' },
};

describe('保険料額表（11/26）', () => {
  it('協会けんぽの額表（東京・令和8年3月分）と、全等級の全額が一致する', () => {
    const rows = premiumTable(HEALTH_ROWS as GradeRow[], PENSION_ROWS as GradeRow[], TOKYO);
    for (const [grade, standard, health, healthCare, support, pension] of EXCEL_TOKYO) {
      const r = rows.find((x) => x.grade === grade)!;
      expect(r.standard).toBe(standard);
      expect(r.health!.total).toBe(health);
      expect(r.healthCare!.total).toBe(healthCare);
      expect(r.childSupport!.total).toBe(support);
      expect(r.pension?.total ?? null).toBe(pension);
    }
  });

  it('折半なら本人分と会社分は同じ。報酬月額の範囲は次の等級の下限まで', () => {
    const r = premiumTable(HEALTH_ROWS as GradeRow[], PENSION_ROWS as GradeRow[], TOKYO);
    expect(r[21].health!.employee).toBe(14775000);
    expect(r[21].health!.employer).toBe(14775000);
    expect(r[0].max).toBe(r[1].min);
    expect(r[r.length - 1].max).toBeNull();
    expect(isHalf(TOKYO)).toBeTrue();
  });

  it('組合で会社の負担が多いときは、本人分と会社分を別に出す。料率がない保険は空', () => {
    const kumiai: RatesForMonth = {
      ...TOKYO,
      health: { employee: 40000, employer: 50000, from: '2026-04', source: 'kumiai' },
      care: null,
    };
    const r = premiumTable(HEALTH_ROWS as GradeRow[], PENSION_ROWS as GradeRow[], kumiai).find(
      (x) => x.standard === 300000,
    )!;
    expect(r.health).toEqual({ total: 27000000, employee: 12000000, employer: 15000000 });
    expect(r.healthCare).toBeNull();
    expect(isHalf(kumiai)).toBeFalse();
  });
});
