import { KumiaiRateInput, MasterRateDoc } from '../../../core/models/rates';
import { latest, OfficeForRates, pickRates, RateTables } from './pick-rates';
import { formatPercent, parsePercent } from './rate-format';

// テスト用の料率マスタ（本物のデータの一部：東京 13・佐賀 41）
const MASTER: MasterRateDoc[] = [
  { kind: 'kyokaiHealth', from: '2024-03', byPrefecture: { '13': 99800, '41': 104200 }, source: 'test' },
  { kind: 'kyokaiHealth', from: '2025-03', byPrefecture: { '13': 99100, '41': 107800 }, source: 'test' },
  { kind: 'kyokaiHealth', from: '2026-03', byPrefecture: { '13': 98500, '41': 105500 }, source: 'test' },
  { kind: 'care', from: '2024-03', rate: 16000, source: 'test' },
  { kind: 'care', from: '2025-03', rate: 15900, source: 'test' },
  { kind: 'care', from: '2026-03', rate: 16200, source: 'test' },
  { kind: 'childSupport', from: '2024-03', rate: 0, source: 'test' },
  { kind: 'childSupport', from: '2026-04', rate: 2300, source: 'test' },
  { kind: 'pension', from: '2024-03', rate: 183000, source: 'test' },
  { kind: 'childContribution', from: '2024-03', rate: 3600, source: 'test' },
];

const kyokai = (prefecture: string): OfficeForRates => ({ prefecture, healthInsurer: { type: 'kyokai' } });
const kumiaiOffice: OfficeForRates = { prefecture: '13', healthInsurer: { type: 'kumiai' } };
const tables = (kumiai: KumiaiRateInput[] = []): RateTables => ({ master: MASTER, kumiai });

describe('latest：その月以前で一番新しいもの', () => {
  const list = [{ from: '2025-03' }, { from: '2024-03' }, { from: '2026-03' }];

  it('並び順に関係なく選べる', () => {
    expect(latest(list, '2025-12')?.from).toBe('2025-03');
  });

  it('適用開始月ちょうどの月は新しい料率', () => {
    expect(latest(list, '2026-03')?.from).toBe('2026-03');
  });

  it('どれよりも前の月は null', () => {
    expect(latest(list, '2024-02')).toBeNull();
  });
});

describe('pickRates：協会けんぽ', () => {
  it('2026年2月分：令和7年度の健保・介護、支援金は0%', () => {
    const r = pickRates(kyokai('13'), tables(), '2026-02');
    expect(r.health).toEqual({ employee: 49550, employer: 49550, from: '2025-03', source: 'kyokai' });
    expect(r.care?.employee).toBe(7950);
    expect(r.childSupport).toEqual({ employee: 0, employer: 0, from: '2024-03', source: 'national' });
  });

  it('2026年3月分：健保・介護は令和8年度に変わるが、支援金はまだ0%', () => {
    const r = pickRates(kyokai('13'), tables(), '2026-03');
    expect(r.health?.employee).toBe(49250);
    expect(r.care?.employee).toBe(8100);
    expect(r.childSupport?.employee).toBe(0);
  });

  it('2026年4月分から支援金 0.23%（本人・会社で折半）', () => {
    const r = pickRates(kyokai('13'), tables(), '2026-04');
    expect(r.childSupport).toEqual({ employee: 1150, employer: 1150, from: '2026-04', source: 'national' });
  });

  it('都道府県で健保の料率が変わる（佐賀 令和8年度 10.55%）', () => {
    const r = pickRates(kyokai('41'), tables(), '2026-11');
    expect(r.health?.employee).toBe(52750);
    expect(r.health?.employer).toBe(52750);
  });

  it('厚生年金は折半、拠出金は会社だけ', () => {
    const r = pickRates(kyokai('13'), tables(), '2026-11');
    expect(r.pension).toEqual({ employee: 91500, employer: 91500, from: '2024-03', source: 'national' });
    expect(r.childContribution).toEqual({ employee: 0, employer: 3600, from: '2024-03', source: 'national' });
  });

  it('データの始まり（2024年3月分）より前は全部「未登録」', () => {
    const r = pickRates(kyokai('13'), tables(), '2024-02');
    expect(r.health).toBeNull();
    expect(r.care).toBeNull();
    expect(r.childSupport).toBeNull();
    expect(r.pension).toBeNull();
    expect(r.childContribution).toBeNull();
  });

  it('表にない都道府県は健保だけ「未登録」', () => {
    const r = pickRates(kyokai('01'), tables(), '2026-11');
    expect(r.health).toBeNull();
    expect(r.pension).not.toBeNull();
  });

  it('折半できない料率（データの間違い）はエラーで止まる', () => {
    const broken: RateTables = {
      master: [{ kind: 'pension', from: '2024-03', rate: 183001, source: 'test' }],
      kumiai: [],
    };
    expect(() => pickRates(kyokai('13'), broken, '2026-11')).toThrowError(/折半できません/);
  });
});

describe('pickRates：組合健保', () => {
  const k2025: KumiaiRateInput = {
    from: '2025-04',
    health: { employee: 38429, employer: 42371 }, // 会社の負担が多い組合
    care: { employee: 8000, employer: 8000 },
    childSupport: { employee: 0, employer: 0 },
  };
  const k2026: KumiaiRateInput = {
    from: '2026-04',
    health: { employee: 40000, employer: 45000 },
    care: { employee: 8500, employer: 8500 },
    childSupport: { employee: 1150, employer: 1150 },
  };

  it('一番新しい適用開始月の料率を、本人分・会社分のまま返す', () => {
    const r = pickRates(kumiaiOffice, tables([k2026, k2025]), '2026-03');
    expect(r.health).toEqual({ employee: 38429, employer: 42371, from: '2025-04', source: 'kumiai' });
    expect(r.childSupport?.employee).toBe(0);
  });

  it('新しい適用開始月になったら切り替わる', () => {
    const r = pickRates(kumiaiOffice, tables([k2025, k2026]), '2026-04');
    expect(r.health?.employee).toBe(40000);
    expect(r.care?.employer).toBe(8500);
    expect(r.childSupport?.employee).toBe(1150);
  });

  it('厚生年金と拠出金は全国一律のもの', () => {
    const r = pickRates(kumiaiOffice, tables([k2025]), '2026-04');
    expect(r.pension?.source).toBe('national');
    expect(r.childContribution?.employer).toBe(3600);
  });

  it('組合の料率が未登録の月は、健保・介護・支援金だけ「未登録」', () => {
    const r = pickRates(kumiaiOffice, tables([k2025]), '2025-03');
    expect(r.health).toBeNull();
    expect(r.care).toBeNull();
    expect(r.childSupport).toBeNull();
    expect(r.pension).not.toBeNull();
  });
});

describe('parsePercent：文字列 → 整数', () => {
  it('小数点以下0〜4桁を整数にする', () => {
    expect(parsePercent('10.06')).toBe(100600);
    expect(parsePercent('4.2371')).toBe(42371);
    expect(parsePercent('0.23')).toBe(2300);
    expect(parsePercent('18.300')).toBe(183000);
    expect(parsePercent('10')).toBe(100000);
  });

  it('「%」付き・全角・前後の空白も受け付ける', () => {
    expect(parsePercent(' 10.06% ')).toBe(100600);
    expect(parsePercent('１０．０６％')).toBe(100600);
  });

  it('読めないものは null', () => {
    expect(parsePercent('')).toBeNull();
    expect(parsePercent('abc')).toBeNull();
    expect(parsePercent('-1')).toBeNull();
    expect(parsePercent('1.23456')).toBeNull();
    expect(parsePercent('.5')).toBeNull();
  });
});

describe('formatPercent：整数 → 表示', () => {
  it('小数は最低2桁、余分な0は消す', () => {
    expect(formatPercent(100600)).toBe('10.06%');
    expect(formatPercent(42371)).toBe('4.2371%');
    expect(formatPercent(183000)).toBe('18.30%');
    expect(formatPercent(2300)).toBe('0.23%');
    expect(formatPercent(0)).toBe('0.00%');
  });

  it('parsePercent と行き来しても変わらない', () => {
    for (const s of ['10.06', '4.2371', '0.23', '9.5']) {
      expect(parsePercent(formatPercent(parsePercent(s)!))).toBe(parsePercent(s));
    }
  });
});