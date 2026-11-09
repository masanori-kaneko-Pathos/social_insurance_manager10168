import { MasterRateDoc, RatesForMonth } from '../../../core/models/rates';
import { CoverageInput } from '../../employees/logic/coverage';
import { pickRates } from '../../rates/logic/pick-rates';
import { calcMonthly, RemunerationLike } from './calc-monthly';
import { dueDateOf, isExpired, periodOf, recalc, RecalcInput } from './recalc';

const MASTER: MasterRateDoc[] = [
  { kind: 'kyokaiHealth', from: '2025-03', byPrefecture: { '13': 99100 }, source: 'test' },
  { kind: 'kyokaiHealth', from: '2026-03', byPrefecture: { '13': 98500 }, source: 'test' },
  { kind: 'care', from: '2025-03', rate: 15900, source: 'test' },
  { kind: 'care', from: '2026-03', rate: 16200, source: 'test' },
  { kind: 'childSupport', from: '2024-03', rate: 0, source: 'test' },
  { kind: 'childSupport', from: '2026-04', rate: 2300, source: 'test' },
  { kind: 'pension', from: '2024-03', rate: 183000, source: 'test' },
  { kind: 'childContribution', from: '2024-03', rate: 3600, source: 'test' },
];
const ratesAt = (month: string): RatesForMonth =>
  pickRates({ prefecture: '13', healthInsurer: { type: 'kyokai' } }, { master: MASTER, kumiai: [] }, month);

const on = (acquiredDate: string, lostDate: string | null = null) => ({ enrolled: true, acquiredDate, lostDate });
const EMP: CoverageInput & { leaves: [] } = {
  birthDate: '1996-05-15',
  health: on('2026-04-01'),
  pension: on('2026-04-01'),
  leaves: [],
};
const rem = (from: string, k: number, hg: number, pg: number): RemunerationLike => ({
  from,
  health: { grade: hg, standard: k * 1000 },
  pension: { grade: pg, standard: k * 1000 },
});
const REMS = [rem('2026-04', 300, 22, 19)];

function input(p: Partial<RecalcInput>): RecalcInput {
  return {
    employee: EMP,
    remunerations: REMS,
    correction: { periods: [] },
    from: '2026-01',
    to: '2026-10',
    ratesAt,
    today: '2026-11-09',
    ...p,
  };
}
const month = (m: string, remunerations = REMS, employee = EMP) =>
  calcMonthly({ month: m, employee, remunerations, rates: ratesAt(m) });

describe('dueDateOf / isExpired：時効（納期限の翌月末から2年）', () => {
  it('2024年8月分の納期限は 2024-09-30。2026-09-30 までは徴収でき、10-01 から時効', () => {
    expect(dueDateOf('2024-08')).toBe('2024-09-30');
    expect(isExpired('2024-08', '2026-09-30')).toBeFalse();
    expect(isExpired('2024-08', '2026-10-01')).toBeTrue();
  });
  it('2月の納期限はうるう年の月末', () => {
    expect(dueDateOf('2028-01')).toBe('2028-02-29');
  });
});

describe('recalc', () => {
  it('訂正しなければ差額は0', () => {
    const r = recalc(input({}));
    expect(r.diffEmployeeYen).toBe(0);
    expect(r.diffEmployerMilli).toBe(0);
    expect(r.months.length).toBe(10);
  });

  it('資格取得日を 4/1 → 1/1 に訂正（手続き漏れ）：1〜3月分が追加徴収', () => {
    // 1〜3月は今のデータでは未加入、訂正後は加入。標準報酬は1月から30万円とする
    const r = recalc(
      input({
        correction: {
          health: on('2026-01-01'),
          pension: on('2026-01-01'),
          periods: [{ from: '2026-01', to: '2026-04', health: { grade: 22, standard: 300000 }, pension: { grade: 19, standard: 300000 } }],
        },
      }),
    );
    const jan = r.months[0];
    expect(jan.beforeEmployeeYen).toBe(0);
    const expected = ['2026-01', '2026-02', '2026-03']
      .map((m) => month(m, [rem(m, 300, 22, 19)], { ...EMP, health: on('2026-01-01'), pension: on('2026-01-01') }).employeeYen)
      .reduce((a, b) => a + b, 0);
    expect(r.diffEmployeeYen).toBe(expected);
    expect(r.months.slice(3).every((m) => m.beforeEmployeeYen === m.afterEmployeeYen)).toBeTrue();
  });

  it('標準報酬を 4〜6月だけ 30万 → 32万に訂正：その3か月だけ差額', () => {
    const r = recalc(
      input({
        correction: {
          periods: [{ from: '2026-04', to: '2026-07', health: { grade: 23, standard: 320000 }, pension: { grade: 20, standard: 320000 } }],
        },
      }),
    );
    const per = month('2026-04', [rem('2026-04', 320, 23, 20)]).employeeYen - month('2026-04').employeeYen;
    expect(per).toBeGreaterThan(0);
    expect(r.months.find((m) => m.month === '2026-04')!.afterEmployeeYen - r.months.find((m) => m.month === '2026-04')!.beforeEmployeeYen).toBe(per);
    expect(r.months.find((m) => m.month === '2026-07')!.afterEmployeeYen).toBe(r.months.find((m) => m.month === '2026-07')!.beforeEmployeeYen);
    expect(r.diffEmployerMilli).toBeGreaterThan(0);
  });

  it('期間の health が null ＝ その期間は健保に入っていない（返金になる）', () => {
    const r = recalc(
      input({
        correction: { periods: [{ from: '2026-05', to: '2026-06', health: null, pension: { grade: 19, standard: 300000 } }] },
      }),
    );
    expect(r.diffEmployeeYen).toBeLessThan(0);
  });

  it('時効の月は合計に入れず、別に出す', () => {
    const emp = { ...EMP, health: on('2024-04-01'), pension: on('2024-04-01') };
    const r = recalc(
      input({
        employee: emp,
        remunerations: [rem('2024-04', 300, 22, 19)],
        correction: { periods: [{ from: '2024-04', to: null, health: { grade: 23, standard: 320000 }, pension: { grade: 20, standard: 320000 } }] },
        from: '2024-04',
        to: '2024-10',
        today: '2026-10-01', // 2024年8月分まで時効
      }),
    );
    expect(r.months.filter((m) => m.expired).map((m) => m.month)).toEqual(['2024-04', '2024-05', '2024-06', '2024-07', '2024-08']);
    expect(r.expiredEmployeeYen).toBeGreaterThan(0);
    expect(r.diffEmployeeYen).toBeGreaterThan(0); // 9・10月分
  });
});

describe('periodOf：画面の1行 → 期間', () => {
  const TABLES = [
    { kind: 'health' as const, from: '2024-03', grades: [{ grade: 22, standard: 300000, min: 290000 }, { grade: 23, standard: 320000, min: 310000 }, { grade: 21, standard: 280000, min: 0 }] },
    { kind: 'pension' as const, from: '2024-03', grades: [{ grade: 19, standard: 300000, min: 290000 }, { grade: 20, standard: 320000, min: 310000 }, { grade: 18, standard: 280000, min: 0 }] },
  ];
  it('報酬月額から等級。「この月まで」は翌月を to にする', () => {
    expect(periodOf('2026-04', '2026-06', 315000, TABLES)).toEqual({
      from: '2026-04', to: '2026-07', health: { grade: 23, standard: 320000 }, pension: { grade: 20, standard: 320000 },
    });
  });
  it('報酬月額が空 ＝ 加入していない。終わりが始まりより前なら null', () => {
    expect(periodOf('2026-04', null, null, TABLES)).toEqual({ from: '2026-04', to: null, health: null, pension: null });
    expect(periodOf('2026-04', '2026-03', 300000, TABLES)).toBeNull();
  });
});
