import { findRates, guessFill, headerOrder, ratesInLine } from './rate-pdf';

describe('組合の料率の PDF：数字を拾う', () => {
  it('% と ‰ と「1000分の」', () => {
    expect(ratesInLine('健康保険料率 9.5%').map((c) => [c.rate, c.shown])).toEqual([[95000, '9.5%']]);
    expect(ratesInLine('健康保険料率 95‰').map((c) => c.rate)).toEqual([95000]);
    expect(ratesInLine('健康保険料 1000分の95').map((c) => c.rate)).toEqual([95000]);
    expect(ratesInLine('介護保険料 千分の18.2').map((c) => c.rate)).toEqual([18200]);
    expect(ratesInLine('健康保険料率 ９．５％').map((c) => c.rate)).toEqual([95000]); // 全角
  });

  it('30%を超える数字・料率でない数字は拾わない', () => {
    expect(ratesInLine('前年比 120% 増、加入者 3,500人')).toEqual([]);
    expect(ratesInLine('令和8年4月分から')).toEqual([]);
  });

  it('どの保険か（同じ行の言葉）', () => {
    expect(ratesInLine('介護保険料率 1.8%')[0].kind).toBe('care');
    expect(ratesInLine('子ども・子育て支援金率 0.23%')[0].kind).toBe('childSupport');
    expect(ratesInLine('一般保険料率 9.5%')[0].kind).toBe('health');
  });

  it('どの欄か：数字のすぐ前の言葉', () => {
    const c = ratesInLine('健康保険 事業主 5.0% 被保険者 4.5% 合計 9.5%');
    expect(c.map((x) => [x.field, x.rate])).toEqual([
      ['employer', 50000],
      ['employee', 45000],
      ['total', 95000],
    ]);
  });

  it('言葉がない3つの数字は、和を全体、残りを書いてある順に本人・会社', () => {
    const c = ratesInLine('健康保険料率 4.5% 5.0% 9.5%');
    expect(c.map((x) => x.field)).toEqual(['employee', 'employer', 'total']);
    // 和にならない3つは、全部「全体」の候補のまま
    expect(ratesInLine('料率 1% 2% 4%').map((x) => x.field)).toEqual(['total', 'total', 'total']);
  });
});

describe('組合の料率の PDF：推し', () => {
  it('保険・欄ごとに最初の値', () => {
    const cands = findRates([
      '令和8年度 健康保険料率のお知らせ',
      '健康保険料率 被保険者 4.5% 事業主 5.0% 計 9.5%',
      '介護保険料率 被保険者 0.9% 事業主 0.9% 計 1.8%',
      '（参考）前年度 健康保険料率 9.3%',
    ]);
    expect(guessFill(cands)).toEqual({
      'health.employee': 45000,
      'health.employer': 50000,
      'health.total': 95000,
      'care.employee': 9000,
      'care.employer': 9000,
      'care.total': 18000,
    });
  });
});

describe('組合の料率の PDF：見出しの並び', () => {
  it('見出しの行から、本人と会社のどちらが先か', () => {
    expect(headerOrder('被保険者 事業主 合計')).toBe('employeeFirst');
    expect(headerOrder('区分 事業主負担 被保険者負担 計')).toBe('employerFirst');
    expect(headerOrder('健康保険 事業主 5.0% 被保険者 4.5%')).toBeNull(); // 数字のある行は見出しではない
    expect(headerOrder('令和8年度のお知らせ')).toBeNull();
  });

  it('事業主の列が先の表は、本人と会社を入れ替えて推す', () => {
    const cands = findRates(['区分 事業主 被保険者 合計', '一般保険料率 5.300% 4.700% 10.000%']);
    expect(guessFill(cands)).toEqual({ 'health.employer': 53000, 'health.employee': 47000, 'health.total': 100000 });
  });

  it('見出しがなければ本人が先', () => {
    expect(guessFill(findRates(['一般保険料率 4.700% 5.300% 10.000%']))['health.employee']).toBe(47000);
  });
});
