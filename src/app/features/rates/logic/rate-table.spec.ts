import { amountOf, eraMonth, readRateTable } from './rate-table';
import { readRateFile } from './rate-csv';

const STDS = [58000, 68000, 78000, 88000, 98000, 104000, 1390000];
const yen = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** 協会けんぽの額表と同じ形（結合セル・案内の行・全額と折半額・介護は「該当する場合」の列） */
function kyokaiLike(): string[][] {
  return [
    ['令和８年３月分（４月納付分）からの健康保険・厚生年金保険の保険料額表', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['　・健康保険料率：令和8年3月分～適用', '', '', '', '　・厚生年金保険料率：平成29年9月分～適用', '', '', '', '・子ども・子育て支援金率：令和8年4月分（5月納付分）～適用', '', '', '', ''],
    ['　・介護保険料率：令和8年3月分～適用', '', '', '', '　・子ども・子育て拠出金率：令和2年4月分～適用　', '', '', '', '', '', '', '', ''],
    ['（北海道支部）', '', '', '', '', '', '', '', '', '', '', '（単位：円）', ''],
    ['標  準  報  酬', '', '報  酬  月  額', '', '', '全国健康保険協会管掌健康保険料・介護保険料', '', '', '', '子ども・子育て支援金', '', '厚生年金保険料', ''],
    ['', '', '', '', '', '介護保険第２号被保険者\nに該当しない場合', '', '介護保険第２号被保険者\nに該当する場合', '', '', '', '一般、坑内員・船員', ''],
    ['等級', '月  額', '', '', '', '10.28%', '', '11.90%', '', '0.23%', '', '18.300%※', ''],
    ['', '', '', '', '', '全  額', '折半額', '全  額', '折半額', '全  額', '折半額', '全  額', '折半額'],
    ['', '', '円以上', '', '円未満', '', '', '', '', '', '', '', ''],
    ...STDS.map((s, i) => [
      i >= 3 && i < 6 ? `${i + 1}(${i - 2})` : String(i === 6 ? 50 : i + 1),
      ` ${s.toLocaleString('en-US')} `, ` ${(s - 5000).toLocaleString('en-US')} `, '～', ` ${(s + 5000).toLocaleString('en-US')} `,
      yen(s * 0.1028), yen(s * 0.0514), yen(s * 0.119), yen(s * 0.0595), yen(s * 0.0023), yen(s * 0.00115),
      i >= 3 && i < 6 ? (s * 0.183).toFixed(2) : '', i >= 3 && i < 6 ? (s * 0.0915).toFixed(2) : '',
    ]),
  ];
}

describe('eraMonth・amountOf', () => {
  it('和暦・全角を読む', () => {
    expect(eraMonth('令和８年３月分')).toBe('2026-03');
    expect(eraMonth('平成29年9月分～適用')).toBe('2017-09');
    expect(eraMonth('令和元年10月分')).toBe('2019-10');
    expect(eraMonth('2027年4月分から')).toBe('2027-04');
    expect(amountOf(' 1,390,000 ')).toBe(1390000);
    expect(amountOf('5,962.4')).toBe(5962.4);
    expect(amountOf('～')).toBeNull();
  });
});

describe('readRateTable：保険料額表から料率を読む（11/17）', () => {
  it('協会けんぽの形：健保10.28%・介護1.62%（11.90% − 10.28%）。支援金は4月分からなので2行', () => {
    const r = readRateTable(kyokaiLike());
    expect(r.problem).toBeNull();
    expect(r.from).toEqual({ health: '2026-03', care: '2026-03', childSupport: '2026-04' });
    expect(r.table!.slice(1)).toEqual([
      ['2026-03', '%', '10.28', '5.14', '5.14', '1.62', '0.81', '0.81', '', '', ''],
      ['2026-04', '%', '10.28', '5.14', '5.14', '1.62', '0.81', '0.81', '0.23', '0.115', '0.115'],
    ]);
  });

  it('組合の形：本人と会社で違う率、介護の列が別、題に何月分から', () => {
    const rows: string[][] = [
      ['テスト健康保険組合 保険料額表（令和9年3月分から）'],
      ['等級', '標準報酬月額', '報酬月額', '', '健康保険料', '', '', '介護保険料', '', ''],
      ['', '', '以上', '未満', '合計', '被保険者負担', '事業主負担', '合計', '被保険者負担', '事業主負担'],
      ...STDS.slice(0, 6).concat([1390000]).map((s, i) => [
        String(i + 1), String(s), String(s - 5000), String(s + 5000),
        String(Math.round(s * 0.09)), String(Math.round(s * 0.04)), String(Math.round(s * 0.05)),
        String(Math.round(s * 0.018)), String(Math.round(s * 0.009)), String(Math.round(s * 0.009)),
      ]),
    ];
    const r = readRateTable(rows);
    expect(r.table!.slice(1)).toEqual([['2027-03', '%', '9', '4', '5', '1.8', '0.9', '0.9', '', '', '']]);
    // 2026年4月分からは支援金が要るので、確認の表ではエラー（その場で直す）
    const f = readRateFile(rows, { range: { from: '0000-01', to: null }, existing: [] });
    expect(f.fromTable).toBeTrue();
    expect(f.rows[0].errors).toEqual(['childSupport.required']);
  });

  it('等級の列がない表は読まない（料率の一覧の見出しが足りない扱いのまま）', () => {
    const f = readRateFile([['月', '率'], ['2026-04', '9.5']], { range: { from: '0000-01', to: null }, existing: [] });
    expect(f.fromTable).toBeFalse();
    expect(f.missing.length).toBeGreaterThan(0);
  });
});
