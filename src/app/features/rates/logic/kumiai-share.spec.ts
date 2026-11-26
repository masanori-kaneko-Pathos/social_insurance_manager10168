import { KumiaiRateInput } from '../../../core/models/rates';
import {
  kumiaiChoicesOf,
  kumiaiKey,
  kumiaiRangesOf,
  sameKumiai,
  sameKumiaiName,
  sharePlan,
  shareTargets,
} from './kumiai-share';

const s = (e: number) => ({ employee: e, employer: e });
const k = (from: string, health: number): KumiaiRateInput => ({
  from,
  health: s(health),
  care: s(9000),
  childSupport: s(1150),
});
const kumiai = (name: string, insurerNumber: string | null = null) => ({
  type: 'kumiai' as const,
  kumiaiName: name,
  insurerNumber,
});
const kyokai = { type: 'kyokai' as const, kumiaiName: null };

type Row = {
  from: string;
  prefecture?: string;
  healthInsurer: {
    type: 'kyokai' | 'kumiai';
    kumiaiName: string | null;
    insurerNumber?: string | null;
  };
};
const office = (id: string, history: Row[], role: 'admin' | 'general' = 'admin') => ({
  id,
  name: `事業所${id}`,
  prefecture: '13',
  healthInsurer: history[history.length - 1].healthInsurer,
  insurerHistory: history.map((h) => ({ prefecture: '13', ...h })),
  memberRoles: { u1: role } as Record<string, 'admin' | 'general'>,
});
const name = (kumiaiName: string) => ({ kumiaiName });

describe('kumiai-share（同じ組合の料率を写す）', () => {
  it('名前は空白と全角・半角の違いを無視して比べる', () => {
    expect(sameKumiaiName('テスト電機健康保険組合', ' テスト電機　健康保険組合 ')).toBeTrue();
    expect(sameKumiaiName('ＡＢＣ健康保険組合', 'ABC健康保険組合')).toBeTrue();
    expect(sameKumiaiName('テスト電機健康保険組合', 'テスト精機健康保険組合')).toBeFalse();
    expect(sameKumiaiName('', '')).toBeFalse();
    expect(kumiaiKey(null)).toBe('');
  });

  it('保険者番号：両方にあれば番号で、片方になければ名前で見分ける', () => {
    expect(
      sameKumiai(
        { kumiaiName: 'テスト電機健保', insurerNumber: '06130488' },
        { kumiaiName: 'テスト電機健康保険組合', insurerNumber: '06130488' },
      ),
    ).toBeTrue();
    expect(
      sameKumiai(
        { kumiaiName: 'テスト電機健康保険組合', insurerNumber: '06130488' },
        { kumiaiName: 'テスト電機健康保険組合', insurerNumber: '06130090' },
      ),
    ).toBeFalse();
    expect(
      sameKumiai(
        { kumiaiName: 'テスト電機健康保険組合', insurerNumber: '06130488' },
        { kumiaiName: 'テスト電機健康保険組合', insurerNumber: null },
      ),
    ).toBeTrue();
  });

  it('組合に入っている期間（都道府県が変わっても同じ組合なら1つ。別の組合・協会けんぽの期間は除く）', () => {
    const o = office('a', [
      { from: '0000-01', healthInsurer: kyokai },
      { from: '2024-04', healthInsurer: kumiai('テスト電機健康保険組合') },
      { from: '2025-04', prefecture: '27', healthInsurer: kumiai('テスト電機健康保険組合') },
      { from: '2026-10', healthInsurer: kumiai('別の健康保険組合') },
    ]);
    expect(kumiaiRangesOf(o, name('テスト電機健康保険組合'))).toEqual([
      { from: '2024-04', to: '2026-10' },
    ]);
    expect(kumiaiRangesOf(o, name('別の健康保険組合'))).toEqual([{ from: '2026-10', to: null }]);
    expect(kumiaiRangesOf(o, name('ない組合'))).toEqual([]);
  });

  it('ほかの事業所：自分は除く。一緒に入れるときは管理者の事業所だけ', () => {
    const list = [
      office('a', [{ from: '0000-01', healthInsurer: kumiai('テスト電機健康保険組合') }]),
      office('b', [{ from: '0000-01', healthInsurer: kumiai('テスト電機健康保険組合') }]),
      office(
        'c',
        [{ from: '0000-01', healthInsurer: kumiai('テスト電機健康保険組合') }],
        'general',
      ),
      office('d', [{ from: '0000-01', healthInsurer: kyokai }]),
    ];
    const key = name('テスト電機健康保険組合');
    expect(shareTargets(list, key, 'a').map((t) => t.officeId)).toEqual(['b', 'c']);
    expect(shareTargets(list, key, 'a', 'u1').map((t) => t.officeId)).toEqual(['b']);
    expect(shareTargets(list, name(''), 'a')).toEqual([]);
  });

  it('番号が同じなら名前が違っても同じ組合（略称で入れていた事業所も見つかる）', () => {
    const list = [
      office('a', [
        { from: '0000-01', healthInsurer: kumiai('テスト電機健康保険組合', '06130488') },
      ]),
      office('b', [{ from: '0000-01', healthInsurer: kumiai('テスト電機健保', '06130488') }]),
    ];
    const key = { kumiaiName: 'テスト電機健康保険組合', insurerNumber: '06130488' };
    expect(shareTargets(list, key, 'a').map((t) => t.officeId)).toEqual(['b']);
  });

  it('名前の候補：同じ名前は1つにまとめ、番号が分かればそれを持つ', () => {
    const list = [
      office('a', [{ from: '0000-01', healthInsurer: kumiai('テスト電機健康保険組合') }]),
      office('b', [
        { from: '0000-01', healthInsurer: kumiai('テスト電機　健康保険組合', '06130488') },
        { from: '2026-04', healthInsurer: kyokai },
      ]),
    ];
    expect(kumiaiChoicesOf(list)).toEqual([
      { name: 'テスト電機健康保険組合', insurerNumber: '06130488' },
    ]);
  });

  it('入れる行：新規・上書き・変わらない・期間の外', () => {
    const plan = sharePlan(
      [k('2023-04', 45000), k('2024-04', 45000), k('2025-03', 46000), k('2026-03', 47000)],
      [k('2024-04', 45000), k('2025-03', 45500)],
      [{ from: '2024-04', to: null }],
    );
    expect(plan.count).toEqual({ new: 1, update: 1, same: 1, outside: 1 });
    expect(plan.items).toEqual([
      { input: k('2025-03', 46000), exists: true },
      { input: k('2026-03', 47000), exists: false },
    ]);
  });
});
