import { InsurerPeriod } from '../../core/models/office';
import {
  deductionPayMonth,
  DEFAULT_PAYROLL,
  everKumiai,
  FROM_THE_START,
  insurerFor,
  insurerHistoryOf,
  payrollOf,
  premiumMonthOfPay,
  premiumMonthsOfPay,
  withDeductionChange,
  deductionAt,
  premiumOf,
  withInsurerChange,
  kumiaiRun,
  spanOf,
  DEFAULT_PREMIUM,
} from './office-settings';

const kyokai = { type: 'kyokai' as const, kumiaiName: null };
const kumiai = { type: 'kumiai' as const, kumiaiName: 'テスト健保組合' };

/** 設定や履歴の項目がない、古い事業所のデータ */
const OLD = { prefecture: '13', healthInsurer: kyokai };

describe('古いデータは初期値で埋める', () => {
  it('給与：月末締め・翌月25日払い・翌月控除', () => {
    expect(payrollOf(OLD)).toEqual(DEFAULT_PAYROLL);
  });

  it('保険料：給与控除・合算', () => {
    expect(premiumOf(OLD)).toEqual({ method: 'payroll', healthRounding: 'combined' });
  });

  it('一部だけ保存されていても、足りない項目は初期値', () => {
    expect(
      premiumOf({ ...OLD, premium: { method: 'cash', healthRounding: 'separate' } }).method,
    ).toBe('cash');
  });

  it('履歴がなければ「最初から今の値」の1行', () => {
    expect(insurerHistoryOf(OLD)).toEqual([
      { from: FROM_THE_START, prefecture: '13', healthInsurer: kyokai },
    ]);
    expect(insurerFor(OLD, '2024-03')).toEqual({ prefecture: '13', healthInsurer: kyokai });
  });
});

describe('月ごとの保険者・都道府県', () => {
  const history: InsurerPeriod[] = [
    { from: '2026-12', prefecture: '13', healthInsurer: kumiai }, // 順番がばらばらでもよい
    { from: FROM_THE_START, prefecture: '13', healthInsurer: kyokai },
  ];
  const office = { prefecture: '13', healthInsurer: kumiai, insurerHistory: history };

  it('切り替えの前の月は協会けんぽ、切り替えの月から組合健保', () => {
    expect(insurerFor(office, '2026-11')?.healthInsurer.type).toBe('kyokai');
    expect(insurerFor(office, '2026-12')?.healthInsurer.type).toBe('kumiai');
  });

  it('組合健保だった時期があれば、組合の料率を読む', () => {
    expect(everKumiai(office)).toBe(true);
    expect(everKumiai(OLD)).toBe(false);
  });

  it('履歴より前の月は null（料率を選べない）', () => {
    const fromLater = {
      ...office,
      insurerHistory: [{ from: '2025-04', prefecture: '13', healthInsurer: kyokai }],
    };
    expect(insurerFor(fromLater, '2025-03')).toBeNull();
  });
});

describe('withInsurerChange：変更を履歴に足す', () => {
  const start: InsurerPeriod[] = [
    { from: FROM_THE_START, prefecture: '13', healthInsurer: kyokai },
  ];

  it('組合健保への切り替えを足す', () => {
    const h = withInsurerChange(start, {
      from: '2026-12',
      prefecture: '13',
      healthInsurer: kumiai,
    });
    expect(h.map((p) => [p.from, p.healthInsurer.type])).toEqual([
      [FROM_THE_START, 'kyokai'],
      ['2026-12', 'kumiai'],
    ]);
  });

  it('移転（都道府県の変更）も同じように足す', () => {
    const h = withInsurerChange(start, {
      from: '2027-04',
      prefecture: '27',
      healthInsurer: kyokai,
    });
    expect(h.map((p) => [p.from, p.prefecture])).toEqual([
      [FROM_THE_START, '13'],
      ['2027-04', '27'],
    ]);
  });

  it('同じ月の変更は置き換え、それより後の行は消える', () => {
    const h1 = withInsurerChange(start, {
      from: '2026-12',
      prefecture: '13',
      healthInsurer: kumiai,
    });
    const h2 = withInsurerChange(h1, { from: '2026-10', prefecture: '27', healthInsurer: kyokai });
    expect(h2.map((p) => p.from)).toEqual([FROM_THE_START, '2026-10']);
    expect(h2[1].prefecture).toBe('27');
  });

  it('1つ前と内容が同じなら、行を足さない', () => {
    expect(
      withInsurerChange(start, { from: '2026-12', prefecture: '13', healthInsurer: kyokai }),
    ).toEqual(start);
  });
});

describe('deductionPayMonth：何月に支払う給与から控除するか', () => {
  it('翌月控除：11月分は12月に支払う給与から（年をまたぐ場合も）', () => {
    expect(deductionPayMonth('2026-11', DEFAULT_PAYROLL)).toBe('2026-12');
    expect(deductionPayMonth('2026-12', DEFAULT_PAYROLL)).toBe('2027-01');
  });

  it('当月控除：11月分は11月に支払う給与から', () => {
    expect(deductionPayMonth('2026-11', { ...DEFAULT_PAYROLL, deduction: 'current' })).toBe(
      '2026-11',
    );
  });
});

describe('kumiaiRun / spanOf / insurerFor の kumiaiSince', () => {
  const kyokai = { type: 'kyokai' as const, kumiaiName: null };
  const kumiaiA = { type: 'kumiai' as const, kumiaiName: 'A健保' };
  const kumiaiB = { type: 'kumiai' as const, kumiaiName: 'B健保' };
  const history: InsurerPeriod[] = [
    { from: '0000-01', prefecture: '13', healthInsurer: kyokai },
    { from: '2025-04', prefecture: '13', healthInsurer: kumiaiA },
    { from: '2025-10', prefecture: '27', healthInsurer: kumiaiA }, // 引っ越しただけ
    { from: '2026-04', prefecture: '27', healthInsurer: kyokai },
    { from: '2026-10', prefecture: '27', healthInsurer: kumiaiB },
  ];
  const office = {
    prefecture: '27',
    healthInsurer: kumiaiB,
    insurerHistory: history,
    payroll: DEFAULT_PAYROLL,
    premium: DEFAULT_PREMIUM,
  };

  it('協会けんぽの行は null', () => {
    expect(kumiaiRun(history, 0)).toBeNull();
  });

  it('同じ組合は、都道府県が変わってもつなげる', () => {
    expect(kumiaiRun(history, 1)).toEqual({ from: '2025-04', to: '2026-04' });
    expect(kumiaiRun(history, 2)).toEqual({ from: '2025-04', to: '2026-04' });
  });

  it('今も続く組合は to が null', () => {
    expect(kumiaiRun(history, 4)).toEqual({ from: '2026-10', to: null });
  });

  it('spanOf は1行だけの期間', () => {
    expect(spanOf(history, 3)).toEqual({ from: '2026-04', to: '2026-10' });
  });

  it('insurerFor：組合の月だけ kumiaiSince が付く', () => {
    expect(insurerFor(office, '2025-12')?.kumiaiSince).toBe('2025-04');
    expect(insurerFor(office, '2026-05')?.kumiaiSince).toBeUndefined();
    expect(insurerFor(office, '2026-11')?.kumiaiSince).toBe('2026-10');
  });
});

describe('premiumMonthOfPay（給与から控除するのは何月分か。11/16）', () => {
  const pay = (deduction: 'current' | 'next') => ({ closingDay: 31, payDay: 25, payMonth: 'next' as const, deduction });
  it('翌月控除なら前の月の分、当月控除なら同じ月の分', () => {
    expect(premiumMonthOfPay('2026-11', pay('next'))).toBe('2026-10');
    expect(premiumMonthOfPay('2026-01', pay('next'))).toBe('2025-12');
    expect(premiumMonthOfPay('2026-11', pay('current'))).toBe('2026-11');
  });
});

describe('控除の時期の履歴（11/20）', () => {
  const next = { ...DEFAULT_PAYROLL, deduction: 'next' as const };
  const cur = { ...DEFAULT_PAYROLL, deduction: 'current' as const };
  // 2026-12月分から、翌月控除 → 当月控除
  const toCurrent = withDeductionChange(null, 'next', { from: '2026-12', deduction: 'current' });

  it('最初の行は「最初から今の設定」。同じ時期への変更は行を足さない', () => {
    expect(toCurrent).toEqual([
      { from: '0000-01', deduction: 'next' },
      { from: '2026-12', deduction: 'current' },
    ]);
    expect(withDeductionChange(toCurrent, 'current', { from: '2027-03', deduction: 'current' })).toEqual(toCurrent);
  });

  it('切り替えの前の月は前の時期、あとの月は新しい時期（履歴がなければ今の設定）', () => {
    expect(deductionAt('2026-11', cur, toCurrent)).toBe('next');
    expect(deductionAt('2026-12', cur, toCurrent)).toBe('current');
    expect(deductionAt('2026-11', cur, null)).toBe('current');
  });

  it('翌月 → 当月：11月分は12月払い、12月分も12月払い → 12月払いの給与から2か月分', () => {
    expect(deductionPayMonth('2026-11', cur, toCurrent)).toBe('2026-12');
    expect(deductionPayMonth('2026-12', cur, toCurrent)).toBe('2026-12');
    expect(premiumMonthsOfPay('2026-12', cur, toCurrent)).toEqual(['2026-11', '2026-12']);
    expect(premiumMonthsOfPay('2026-11', cur, toCurrent)).toEqual(['2026-10']);
    expect(premiumMonthsOfPay('2027-01', cur, toCurrent)).toEqual(['2027-01']);
  });

  it('当月 → 翌月：12月分から翌月控除 → 12月払いの給与からは控除しない', () => {
    const toNext = withDeductionChange(null, 'current', { from: '2026-12', deduction: 'next' });
    expect(premiumMonthsOfPay('2026-11', next, toNext)).toEqual(['2026-11']);
    expect(premiumMonthsOfPay('2026-12', next, toNext)).toEqual([]);
    expect(premiumMonthsOfPay('2027-01', next, toNext)).toEqual(['2026-12']);
    expect(premiumMonthOfPay('2026-12', next, toNext)).toBe('2026-11');
  });

  it('履歴がない事業所は今までどおり', () => {
    expect(premiumMonthsOfPay('2026-11', next)).toEqual(['2026-10']);
    expect(premiumMonthsOfPay('2026-11', cur)).toEqual(['2026-11']);
  });
});
