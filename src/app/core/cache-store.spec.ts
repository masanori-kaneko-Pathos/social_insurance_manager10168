import { cached, cacheKey, forget, forgetAll, forgetForWrite, peek } from './cache-store';

describe('cache-store：読んだデータを覚えておく', () => {
  beforeEach(() => forgetAll());

  it('2回目は読みに行かない（読んでいる途中のものも使い回す）', async () => {
    let n = 0;
    const load = async () => ++n;
    const a = cached('k', load, 1000, 0);
    const b = cached('k', load, 1000, 10);
    expect(await a).toBe(1);
    expect(await b).toBe(1);
    expect(n).toBe(1);
  });

  it('時間が過ぎたら読み直す', async () => {
    let n = 0;
    await cached('k', async () => ++n, 1000, 0);
    expect(await cached('k', async () => ++n, 1000, 1000)).toBe(2);
  });

  it('失敗したら覚えない', async () => {
    await cached('k', () => Promise.reject(new Error('x')), 1000, 0).catch(() => undefined);
    expect(await cached('k', async () => 'ok', 1000, 1)).toBe('ok');
  });

  it('peek は読みに行かない', async () => {
    expect(peek('k', 1000, 0)).toBeNull();
    await cached('k', async () => 1, 1000, 0);
    expect(await peek<number>('k', 1000, 5)!).toBe(1);
  });

  it('forget はその下の鍵も忘れる（別の事業所は残る）', async () => {
    await cached('contracts/o1/e1', async () => 1, 1000, 0);
    await cached('contracts/o1/e2', async () => 1, 1000, 0);
    await cached('contracts/o2/e1', async () => 1, 1000, 0);
    forget('contracts/o1');
    expect(peek('contracts/o1/e1', 1000, 1)).toBeNull();
    expect(peek('contracts/o2/e1', 1000, 1)).not.toBeNull();
  });

  it('書き込みの target ごとに忘れるもの', async () => {
    const keys = [cacheKey.employees('o'), cacheKey.contracts('o', 'e'), cacheKey.remunerations('o', 'e')];
    const fill = async () => {
      for (const k of keys) await cached(k, async () => 1, 1000, 0);
    };
    await fill();
    forgetForWrite('o', 'e', 'contracts/2026-04-01');
    expect(keys.map((k) => peek(k, 1000, 1) !== null)).toEqual([true, false, true]);
    await fill();
    forgetForWrite('o', 'e', 'employee');
    expect(keys.map((k) => peek(k, 1000, 1) !== null)).toEqual([false, true, true]);
    await fill();
    forgetForWrite('o', 'e', 'details/private'); // 一覧に入っていないので忘れない
    expect(keys.map((k) => peek(k, 1000, 1) !== null)).toEqual([true, true, true]);
  });
});
