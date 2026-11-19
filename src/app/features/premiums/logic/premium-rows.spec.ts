import { DEFAULT_PREMIUM_OPTIONS } from '../../../core/models/premium';
import { MasterRateDoc } from '../../../core/models/rates';
import { CoverageInput } from '../../employees/logic/coverage';
import { pickRates } from '../../rates/logic/pick-rates';
import { RemunerationLike } from './calc-monthly';
import { buildPremiumRow, isLastMonthBeforeLeaving } from './premium-rows';

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

const ratesFor = (month: string) =>
  pickRates(
    { prefecture: '13', healthInsurer: { type: 'kyokai' } },
    { master: MASTER, kumiai: [] },
    month,
  );

const person = (birthDate: string, acquiredDate: string): CoverageInput => ({
  birthDate,
  health: { enrolled: true, acquiredDate, lostDate: null },
  pension: { enrolled: true, acquiredDate, lostDate: null },
});

const rem = (from: string, h: [number, number], p: [number, number]): RemunerationLike => ({
  from,
  health: { grade: h[0], standard: h[1] },
  pension: { grade: p[0], standard: p[1] },
});

const row = (month: string, employee: CoverageInput, remunerations: RemunerationLike[]) =>
  buildPremiumRow({ month, employee, remunerations, ratesFor, options: DEFAULT_PREMIUM_OPTIONS });

describe('buildPremiumRow：一覧の1行', () => {
  const A = person('1990-05-15', '2024-04-01');
  const remA = [
    rem('2024-04', [22, 300000], [19, 300000]),
    rem('2025-09', [23, 320000], [20, 320000]),
  ];

  it('テスト一郎（A）の2026年11月分：等級と本人負担の内訳', () => {
    const r = row('2026-11', A, remA);
    expect(r.state).toBe('ok');
    expect(r.health).toEqual({ grade: 23, standard: 320000 });
    expect(r.pension).toEqual({ grade: 20, standard: 320000 });
    expect(r.care).toBe(false);
    expect(r.healthEmployeeYen).toBe(16128);
    expect(r.pensionEmployeeYen).toBe(29280);
    expect(r.changes).toEqual([]); // 10月分と同じ
  });

  it('全額・会社負担は保険料だけ、拠出金は別（A の2026年11月分）', () => {
    const r = row('2026-11', A, remA);
    expect(r.premiumTotalMilli).toBe(90816000); // 健保等 32,256 ＋ 厚年 58,560（額表の数字）
    expect(r.premiumEmployerMilli).toBe(45408000); // 90,816 − 本人 45,408
    expect(r.contributionMilli).toBe(1152000); // 320,000 × 0.36%
    expect(r.result!.totalMilli).toBe(91968000); // 結果全体には拠出金も入っている
  });

  it('等級が変わった月は grade（A の2025年9月分）', () => {
    expect(row('2025-09', A, remA).changes).toEqual(['grade']);
  });

  it('届出なしの一斉改定の行から始まる月は cap（等級変更の代わり。11/16）', () => {
    const rems: RemunerationLike[] = [
      rem('2025-09', [40, 830000], [32, 650000]),
      { ...rem('2027-09', [40, 830000], [33, 680000]), capRevised: ['pension'] },
    ];
    expect(row('2027-09', A, rems).changes).toEqual(['cap']);
    expect(row('2027-09', A, rems).pension).toEqual({ grade: 33, standard: 680000 });
    expect(row('2027-10', A, rems).changes).toEqual([]);
  });

  it('料率が変わった月は rate（2026年3月分：令和8年度の料率）', () => {
    expect(row('2026-03', A, remA).changes).toEqual(['rate']);
  });

  it('支援金が始まった月も rate（2026年4月分）', () => {
    expect(row('2026-04', A, remA).changes).toEqual(['rate']);
  });

  it('介護が始まった月は careStart（テスト二郎 B の2026年11月分）', () => {
    const B = person('1986-12-01', '2025-04-01');
    const r = row('2026-11', B, [rem('2025-04', [5, 98000], [2, 98000])]);
    expect(r.care).toBe(true);
    expect(r.changes).toEqual(['careStart']);
  });

  it('介護が終わった月は careEnd（65歳の到達日 2026-12-01 → 12月分から介護なし）', () => {
    const S = person('1961-12-02', '2020-04-01');
    const r = row('2026-12', S, [rem('2020-04', [24, 340000], [21, 340000])]);
    expect(r.care).toBe(false);
    expect(r.changes).toEqual(['careEnd']);
  });

  it('加入した最初の月は new', () => {
    const F = person('1995-01-10', '2026-06-10');
    expect(row('2026-06', F, [rem('2026-06', [2, 68000], [1, 88000])]).changes).toEqual(['new']);
  });

  it('標準報酬が未登録なら missing（変更の印は付けない）', () => {
    const r = row('2026-11', A, []);
    expect(r.state).toBe('missing');
    expect(r.changes).toEqual([]);
  });

  it('加入していない月は none', () => {
    expect(row('2024-03', A, remA).state).toBe('none');
  });

  it('産休・育休で免除の月は exempt。標準報酬月額は出し、保険料は0', () => {
    const onLeave = {
      ...A,
      leaves: [{ kind: 'maternity', start: '2026-10-20', end: '2027-01-14', filed: { filedOn: '2026-10-25' } }],
    };
    const r = row('2026-11', onLeave, remA);
    expect(r.state).toBe('exempt');
    expect(r.health).toEqual({ grade: 23, standard: 320000 });
    expect(r.premiumTotalMilli).toBe(0);
  });
});

describe('isLastMonthBeforeLeaving：退職前の最後の月（2か月分の控除の案内。11/19）', () => {
  const leaving = (lostDate: string, reason: string | null) => ({
    birthDate: '1990-05-15',
    health: { enrolled: true, acquiredDate: '2024-04-01', lostDate, lossReason: reason },
    pension: { enrolled: true, acquiredDate: '2024-04-01', lostDate, lossReason: reason },
  });

  it('8/31 退職（喪失日 9/1）：8月分が最後の月。7月・9月は違う', () => {
    const e = leaving('2026-09-01', 'retire');
    expect(isLastMonthBeforeLeaving(e, '2026-08')).toBeTrue();
    expect(isLastMonthBeforeLeaving(e, '2026-07')).toBeFalse();
    expect(isLastMonthBeforeLeaving(e, '2026-09')).toBeFalse();
  });

  it('8/20 退職（喪失日 8/21）：喪失月の8月は保険料がかからないので、7月分が最後の月', () => {
    const e = leaving('2026-08-21', 'retire');
    expect(isLastMonthBeforeLeaving(e, '2026-07')).toBeTrue();
    expect(isLastMonthBeforeLeaving(e, '2026-08')).toBeFalse();
  });

  it('死亡・原因が空の古いデータも対象。75歳・任意喪失は対象外（働き続けている）', () => {
    expect(isLastMonthBeforeLeaving(leaving('2026-09-01', 'death'), '2026-08')).toBeTrue();
    expect(isLastMonthBeforeLeaving(leaving('2026-09-01', null), '2026-08')).toBeTrue();
    expect(isLastMonthBeforeLeaving(leaving('2026-09-01', 'age75'), '2026-08')).toBeFalse();
    expect(isLastMonthBeforeLeaving(leaving('2026-09-01', 'optOut'), '2026-08')).toBeFalse();
  });

  it('厚年は70歳で先に喪失していても、健保の退職で最後の月になる', () => {
    const e = {
      birthDate: '1955-01-15',
      health: { enrolled: true, acquiredDate: '2010-04-01', lostDate: '2026-09-01', lossReason: 'retire' },
      pension: { enrolled: true, acquiredDate: '2010-04-01', lostDate: '2025-01-14', lossReason: null },
    };
    expect(isLastMonthBeforeLeaving(e, '2026-08')).toBeTrue();
  });

  it('一覧の行にも付く（保険料がかかる月だけ）', () => {
    const e = leaving('2026-09-01', 'retire');
    const remE = [rem('2024-04', [22, 300000], [19, 300000])];
    expect(row('2026-08', e, remE).lastMonth).toBeTrue();
    expect(row('2026-07', e, remE).lastMonth).toBeFalse();
  });
});
