import type { ClassifyContract, ClassifyCriteria, ClassifyOffice } from '../../employees/logic/classify';
import { adjustmentResolver, AdjustmentContext } from './adjustment-eligibility';

const OFFICE: ClassifyOffice = { standardHours: { weeklyMinutes: 2400, monthlyDays: 20 }, specificApplication: { since: '2026-10' } };
const CRITERIA: ClassifyCriteria[] = [{ from: '2026-10', weeklyMinutesMin: 1200, wageMin: null, reducedWageMin: 88000 }];
const contract = (p: Partial<ClassifyContract> = {}): ClassifyContract => ({
  from: '2026-04-01', weeklyMinutes: 1200, monthlyDays: 12, scheduledWage: 100000, periodEnd: null,
  renewal: 'none', student: 'none', minimumWageReduction: false, ...p,
});
const enr = { enrolled: true, acquiredDate: '2026-10-01', lostDate: null };
const rem = (from: string, h: number, p: number) => ({ from, health: { grade: 1, standard: h }, pension: { grade: 1, standard: p } });

function ctx(over: Partial<AdjustmentContext> = {}): AdjustmentContext {
  return {
    since: '2026-10',
    person: { birthDate: '1990-05-15', optInDate: null, optOutDate: null, contracts: [contract()] },
    employee: { birthDate: '1990-05-15', health: enr, pension: enr },
    remunerations: [rem('2026-10', 98000, 98000)],
    office: OFFICE,
    criteria: CRITERIA,
    kumiaiAt: () => false,
    ...over,
  };
}

describe('adjustmentResolver（保険料調整制度の対象の月。11/16）', () => {
  it('短時間労働者・12.6万円以下・始めた月から → 健保・厚年とも軽減', () => {
    const f = adjustmentResolver(ctx());
    expect(f('2026-09')).toBeNull();
    expect(f('2026-10')).toEqual({ health: 2000, pension: 2000 });
  });

  it('4分の3以上で働く人（短時間労働者でない）は対象外', () => {
    const f = adjustmentResolver(ctx({ person: { birthDate: '1990-05-15', optInDate: null, optOutDate: null, contracts: [contract({ weeklyMinutes: 2400, monthlyDays: 20 })] } }));
    expect(f('2026-10')).toBeNull();
  });

  it('健保と厚年で標準報酬が違えば、それぞれの割合（12.6万円を超えた方は0）', () => {
    const f = adjustmentResolver(ctx({ remunerations: [rem('2026-10', 134000, 88000)] }));
    expect(f('2026-10')).toEqual({ health: 0, pension: 2500 });
  });

  it('組合健保の月は、健保を軽減しない', () => {
    const f = adjustmentResolver(ctx({ kumiaiAt: () => true }));
    expect(f('2026-10')).toEqual({ health: 0, pension: 2000 });
  });

  it('申し出ていない事業所は、いつでも null', () => {
    expect(adjustmentResolver(ctx({ since: null }))('2026-10')).toBeNull();
  });
});
