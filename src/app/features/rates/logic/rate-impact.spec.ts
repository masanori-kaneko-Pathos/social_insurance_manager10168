import { KumiaiRateInput, MonthRange } from '../../../core/models/rates';
import { applyRates, impactStart, rateImpact, spansOf } from './rate-impact';

const s = (e: number, r: number = e) => ({ employee: e, employer: r });
const k = (from: string, health: number, care = 9000, child = 1150): KumiaiRateInput => ({
  from,
  health: s(health),
  care: s(care),
  childSupport: s(child),
});
const open: MonthRange = { from: '2024-04', to: null };

describe('rateImpact（組合の料率を入れ直したときの影響）', () => {
  const before = [k('2024-04', 45000), k('2025-03', 46000), k('2026-03', 47000)];

  it('期間の途中の行を上書きすると、次の行の前の月までが変わる', () => {
    const after = applyRates(before, [k('2025-03', 46500)]);
    const r = rateImpact(before, after, open, []);
    expect(r.changed).toEqual([{ from: '2025-03', to: '2026-02' }]);
    expect(r.changedCount).toBe(12);
  });

  it('最後の行を上書きすると、期間の終わりまで続く（数は出さない）', () => {
    const after = applyRates(before, [k('2026-03', 47500)]);
    const r = rateImpact(before, after, open, []);
    expect(r.changed).toEqual([{ from: '2026-03', to: null }]);
    expect(r.changedCount).toBeNull();
  });

  it('期間に終わりがあれば、終わりの前の月まで', () => {
    const after = applyRates(before, [k('2026-03', 47500)]);
    const r = rateImpact(before, after, { from: '2024-04', to: '2027-01' }, []);
    expect(r.changed).toEqual([{ from: '2026-03', to: '2026-12' }]);
    expect(r.changedCount).toBe(10);
  });

  it('値が同じ上書きは、何も変わらない', () => {
    const after = applyRates(before, [k('2025-03', 46000)]);
    const r = rateImpact(before, after, open, ['2025-06']);
    expect(r.changed).toEqual([]);
    expect(r.changedCount).toBe(0);
    expect(r.closed).toEqual([]);
  });

  it('前の行と同じ値の行を足しても、何も変わらない', () => {
    const after = applyRates(before, [k('2025-09', 46000)]);
    expect(rateImpact(before, after, open, []).changed).toEqual([]);
  });

  it('間に新しい行を足すと、その月から次の行の前まで', () => {
    const after = applyRates(before, [k('2025-09', 46200)]);
    expect(rateImpact(before, after, open, []).changed).toEqual([
      { from: '2025-09', to: '2026-02' },
    ]);
  });

  it('介護・支援金だけ違っても変わる（本人分・会社分の分け方の違いも）', () => {
    const care = applyRates(before, [k('2026-03', 47000, 9200)]);
    expect(rateImpact(before, care, open, []).changed).toEqual([{ from: '2026-03', to: null }]);
    const split = applyRates(before, [{ ...k('2026-03', 47000), health: s(46000, 48000) }]);
    expect(rateImpact(before, split, open, []).changed).toEqual([{ from: '2026-03', to: null }]);
  });

  it('削除すると、前の行に戻る月が変わる', () => {
    const after = applyRates(before, [], ['2025-03']);
    expect(rateImpact(before, after, open, []).changed).toEqual([
      { from: '2025-03', to: '2026-02' },
    ]);
  });

  it('料率がなかった月に入れると「変わる」（計算できなかった月が計算できるようになる）', () => {
    const late = [k('2024-10', 45000)];
    const after = applyRates(late, [k('2024-04', 45000)]);
    expect(rateImpact(late, after, open, []).changed).toEqual([{ from: '2024-04', to: '2024-09' }]);
  });

  it('何年分もまとめて入れると、変わる月がとびとびになることもある', () => {
    const after = applyRates(before, [
      k('2024-04', 45500),
      k('2025-03', 46000),
      k('2026-03', 47500),
    ]);
    const r = rateImpact(before, after, open, []);
    expect(r.changed).toEqual([
      { from: '2024-04', to: '2025-02' },
      { from: '2026-03', to: null },
    ]);
  });

  it('確認済みの月のうち、変わる月だけ数える', () => {
    const after = applyRates(before, [k('2026-03', 47500)]);
    const r = rateImpact(before, after, open, [
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-08',
      '2026-04',
    ]);
    expect(r.closed).toEqual(['2026-03', '2026-04', '2026-08']);
  });

  it('期間の外の行（別の組合の行）は使わない', () => {
    const range: MonthRange = { from: '2025-03', to: null };
    const after = applyRates(before, [k('2024-04', 40000)]);
    expect(rateImpact(before, after, range, []).changed).toEqual([]);
  });
});

describe('spansOf', () => {
  it('続いた月をまとめる', () => {
    expect(spansOf(['2026-01', '2026-02', '2026-04', '2026-12', '2027-01'])).toEqual([
      { from: '2026-01', to: '2026-02' },
      { from: '2026-04', to: '2026-04' },
      { from: '2026-12', to: '2027-01' },
    ]);
  });
});

describe('impactStart', () => {
  const before = [k('2025-03', 46000), k('2026-03', 47000)];
  it('値が変わる行のうち一番古い月', () => {
    expect(
      impactStart(before, [k('2026-03', 47500), k('2025-03', 46000), k('2025-09', 46100)]),
    ).toBe('2025-09');
  });
  it('削除は、その月から', () => {
    expect(impactStart(before, [], ['2025-03'])).toBe('2025-03');
  });
  it('変わる行がなければ null', () => {
    expect(impactStart(before, [k('2026-03', 47000)])).toBeNull();
  });
});
