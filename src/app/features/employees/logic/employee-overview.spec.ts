import { missingInfo, OverviewTarget, remunerationAt, tabOf } from './employee-overview';

describe('tabOf', () => {
  it('知っているタブはそのまま、それ以外は概要', () => {
    expect(tabOf('pay')).toBe('pay');
    expect(tabOf(null)).toBe('overview');
    expect(tabOf('xyz')).toBe('overview');
  });
});

describe('remunerationAt：その月に効いている標準報酬', () => {
  const rows = [{ from: '2024-04' }, { from: '2025-09' }, { from: '2026-12' }];
  it('その月以前でいちばん新しい行', () => {
    expect(remunerationAt(rows, '2026-11')?.from).toBe('2025-09');
    expect(remunerationAt(rows, '2026-12')?.from).toBe('2026-12');
  });
  it('まだ始まっていなければ null', () => {
    expect(remunerationAt(rows, '2024-03')).toBeNull();
  });
});

describe('missingInfo：足りない情報', () => {
  const full: OverviewTarget = {
    sex: 'male',
    basicPensionNumber: '1234567890',
    insuredNumber: '12',
    health: { enrolled: true },
    pension: { enrolled: true },
    retireDate: null,
  };
  const ok = { hasContract: true, remunerationNow: true, address: '東京都', today: '2026-11-10' };

  it('そろっていれば何もない', () => {
    expect(missingInfo(full, ok)).toEqual([]);
  });
  it('T04（加入前）：番号は要らない。契約・性別だけ見る', () => {
    const t04 = { ...full, health: { enrolled: false }, pension: { enrolled: false }, basicPensionNumber: null, insuredNumber: null };
    expect(missingInfo(t04, { ...ok, remunerationNow: false })).toEqual([]);
  });
  it('加入しているのに標準報酬・番号・住所がない', () => {
    const e = { ...full, basicPensionNumber: null, insuredNumber: null };
    expect(missingInfo(e, { ...ok, remunerationNow: false, address: null })).toEqual([
      'noRemuneration',
      'noBasicPensionNumber',
      'noInsuredNumber',
      'noAddress',
    ]);
  });
  it('住所を読めない人（一般ユーザー）には、住所を出さない', () => {
    expect(missingInfo(full, { ...ok, address: undefined })).toEqual([]);
  });
  it('退職した人は、契約と標準報酬を求めない', () => {
    const e = { ...full, retireDate: '2026-08-20' };
    expect(missingInfo(e, { ...ok, hasContract: false, remunerationNow: false })).toEqual([]);
  });
});
