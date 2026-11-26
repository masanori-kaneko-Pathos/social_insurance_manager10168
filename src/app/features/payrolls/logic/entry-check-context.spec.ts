import { entryCheckContextOf, EntryCheckSource } from './entry-check-context';

// 材料の組み立てだけを見る（判定の決まりは entry-check.spec.ts）
const schedule = { closingDay: 31, payDay: 25, payMonth: 'next' as const };
const contract = (from: string, x: Record<string, unknown> = {}) =>
  ({ from, payType: 'monthly', hourlyWage: null, dailyWage: null, weeklyMinutes: 2400, employmentType: 'regular', ...x }) as never;
const rem = (from: string, health: number, pension: number) =>
  ({ from, reason: 'regular', monthlyAmount: health, health: { grade: 1, standard: health }, pension: { grade: 1, standard: pension } }) as never;

const source = (x: Partial<EntryCheckSource> = {}): EntryCheckSource => ({
  employee: { id: 'e1', birthDate: '1990-01-01', hireDate: '2020-04-01', optInDate: null, optOutDate: null } as never,
  office: { standardHours: null, specificApplication: undefined },
  month: '2026-11',
  schedule,
  premiumMonth: '2026-10',
  contracts: [contract('2020-04-01')],
  criteria: [],
  remunerations: [rem('2025-09', 280000, 280000), rem('2026-09', 300000, 300000)],
  prev: null,
  ...x,
});

describe('entryCheckContextOf：「この入力で決まること」の材料（11/26）', () => {
  it('今の標準報酬月額は、この給与から控除する保険料の月のもの', () => {
    expect(entryCheckContextOf(source()).standard).toEqual({ health: 300000, pension: 300000 });
    expect(entryCheckContextOf(source({ premiumMonth: '2026-08' })).standard).toEqual({ health: 280000, pension: 280000 });
    expect(entryCheckContextOf(source({ remunerations: [] })).standard).toBeNull();
  });

  it('前の月の給与は、比べる額だけを渡す', () => {
    const prev = { fixed: 290000, fixedFull: 300000, inKind: 0 } as never;
    expect(entryCheckContextOf(source({ prev })).prev).toEqual({ fixed: 290000, fixedFull: 300000, inKind: 0 });
    expect(entryCheckContextOf(source()).prev).toBeNull();
  });

  it('時給の人で、時給が変わった契約の起算月なら contractChange に向きが入る', () => {
    const contracts = [
      contract('2025-04-01', { payType: 'hourly', hourlyWage: 1200, employmentType: 'part' }),
      contract('2026-10-01', { payType: 'hourly', hourlyWage: 1300, employmentType: 'part' }),
    ];
    // 末日締め・翌月払い：10/1 からの契約は、11月払い（計算期間 10/1〜10/31）が1か月そろった最初の月
    const c = entryCheckContextOf(source({ contracts }));
    expect(c.contractChange).toBe('up');
    expect(c.byUnit).toBeTrue();
    expect(entryCheckContextOf(source({ contracts, month: '2026-12' })).contractChange).toBeNull();
  });

  it('月給の人は byUnit が false、基準は17日（短時間労働者でない）', () => {
    const c = entryCheckContextOf(source());
    expect(c.byUnit).toBeFalse();
    expect(c.minDays).toBe(17);
  });
});
