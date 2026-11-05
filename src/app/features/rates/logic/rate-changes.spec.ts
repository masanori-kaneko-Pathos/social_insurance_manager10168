import { MasterRateDoc } from '../../../core/models/rates';
import { inRange, kyokaiChanges } from './rate-changes';

describe('inRange', () => {
  it('始まりの月は含み、終わり（to）の月は含まない', () => {
    const r = { from: '2025-04', to: '2026-04' };
    expect(inRange('2025-04', r)).toBeTrue();
    expect(inRange('2026-03', r)).toBeTrue();
    expect(inRange('2026-04', r)).toBeFalse();
    expect(inRange('2025-03', r)).toBeFalse();
  });

  it('to が null なら今も続いている', () => {
    expect(inRange('2099-12', { from: '2025-04', to: null })).toBeTrue();
  });
});

describe('kyokaiChanges', () => {
  // 東京：令和6年度 9.98%・令和7年度 9.91%
  const master: MasterRateDoc[] = [
    { kind: 'kyokaiHealth', from: '2024-03', byPrefecture: { '13': 99800 }, source: 'test' },
    { kind: 'kyokaiHealth', from: '2025-03', byPrefecture: { '13': 99100 }, source: 'test' },
    { kind: 'care', from: '2024-03', rate: 16000, source: 'test' },
    { kind: 'care', from: '2025-03', rate: 15900, source: 'test' },
    { kind: 'childSupport', from: '2024-03', rate: 0, source: 'test' },
    { kind: 'childSupport', from: '2026-04', rate: 2300, source: 'test' },
    { kind: 'pension', from: '2024-03', rate: 183000, source: 'test' },
  ];

  it('期間の始まりの月と、期間の中で変わった月が並ぶ', () => {
    const rows = kyokaiChanges(master, '13', { from: '2024-04', to: '2025-06' });
    expect(rows.map((r) => r.month)).toEqual(['2024-04', '2025-03']);
    // 始まりの月は、期間より前（2024-03）に決まった料率
    expect(rows[0].health?.from).toBe('2024-03');
    expect(rows[0].health?.employee).toBe(49900);
    expect(rows[1].care?.employee).toBe(7950);
  });

  it('「登録時から」の行は、料率がない始まりの月を出さない', () => {
    const rows = kyokaiChanges(master, '13', { from: '0000-01', to: null });
    expect(rows.map((r) => r.month)).toEqual(['2024-03', '2025-03', '2026-04']);
  });

  it('厚生年金だけが変わった月は出さない', () => {
    const withPension: MasterRateDoc[] = [
      ...master,
      { kind: 'pension', from: '2024-09', rate: 183000, source: 'test' },
    ];
    const rows = kyokaiChanges(withPension, '13', { from: '2024-04', to: '2025-01' });
    expect(rows.map((r) => r.month)).toEqual(['2024-04']);
  });
});
