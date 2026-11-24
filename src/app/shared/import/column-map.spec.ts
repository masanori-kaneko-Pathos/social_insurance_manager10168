import {
  excelSerialToDate,
  guessMapping,
  headerKey,
  ImportField,
  isOurFormat,
  missingRequired,
  normalizeDate,
  normalizeDays,
  normalizeDigits,
  normalizeKana,
  normalizeMonth,
  normalizeNumber,
  splitName,
  toOurTable,
  unusedColumns,
  canSum,
  fromSavedMapping,
  toSavedMapping,
  sumCells,
  Mapping,
  OurTableSpec,
} from './column-map';

type K = 'no' | 'name' | 'hire' | 'a' | 'b' | 'ab';
const FIELDS: ImportField<K>[] = [
  { key: 'no', header: '社員番号', words: ['従業員コード'], required: true },
  { key: 'name', header: '姓', words: ['氏'] },
  { key: 'hire', header: '入社日', words: ['入社年月日'], kind: 'date', required: true },
  { key: 'a', header: 'A', words: [] },
  { key: 'b', header: 'B', words: [] },
  { key: 'ab', header: 'AB', words: [], required: true, orFrom: ['a', 'b'] },
];

describe('column-map：日付の言い直し', () => {
  it('西暦のいろいろな形', () => {
    expect(normalizeDate('2026/4/1')).toBe('2026-04-01');
    expect(normalizeDate('2026-04-01')).toBe('2026-04-01');
    expect(normalizeDate('2026.4.1')).toBe('2026-04-01');
    expect(normalizeDate('2026年4月1日')).toBe('2026-04-01');
    expect(normalizeDate('20260401')).toBe('2026-04-01');
    expect(normalizeDate('２０２６／４／１')).toBe('2026-04-01');
  });

  it('後ろに時刻がついていても日付だけ', () => {
    expect(normalizeDate('2026/10/1 0:00')).toBe('2026-10-01');
    expect(normalizeDate('2026-10-01T09:30:00')).toBe('2026-10-01');
  });

  it('Excel の日付の数', () => {
    expect(normalizeDate('46113')).toBe('2026-04-01');
    expect(excelSerialToDate(46113)).toBe('2026-04-01');
    expect(excelSerialToDate(46113.75)).toBe('2026-04-01'); // 時刻の部分は捨てる
    expect(excelSerialToDate(32874)).toBe('1990-01-01');
  });

  it('和暦（令和・平成・昭和、元年、略字）', () => {
    expect(normalizeDate('R8.4.1')).toBe('2026-04-01');
    expect(normalizeDate('令和8年4月1日')).toBe('2026-04-01');
    expect(normalizeDate('令和元年5月1日')).toBe('2019-05-01');
    expect(normalizeDate('H2.12.24')).toBe('1990-12-24');
    expect(normalizeDate('平成31年4月30日')).toBe('2019-04-30');
    expect(normalizeDate('S50.1.1')).toBe('1975-01-01');
    expect(normalizeDate('ｈ２/１/１')).toBe('1990-01-01');
  });

  it('ない日・読めないものは、元の文字のまま（確認画面でエラーにする）', () => {
    expect(normalizeDate('2026/2/30')).toBe('2026/2/30');
    expect(normalizeDate('20261301')).toBe('20261301');
    expect(normalizeDate('入社予定')).toBe('入社予定');
    expect(normalizeDate('2026/4')).toBe('2026/4'); // 日がない
    expect(normalizeDate('')).toBe('');
  });

  it('年月は月まで（日があっても落とす）', () => {
    expect(normalizeMonth('2026/10')).toBe('2026-10');
    expect(normalizeMonth('2026/10/25')).toBe('2026-10');
    expect(normalizeMonth('2026年10月')).toBe('2026-10');
    expect(normalizeMonth('202610')).toBe('2026-10');
    expect(normalizeMonth('R8.10')).toBe('2026-10');
    expect(normalizeMonth('46296')).toBe('2026-10'); // 2026-10-01 の Excel の数
    expect(normalizeMonth('2026/13')).toBe('2026/13');
  });
});

describe('column-map：そのほかの言い直し', () => {
  it('カナ：半角カナ・ひらがな → 全角カタカナ（濁点もつなぐ）', () => {
    expect(normalizeKana('ﾔﾏﾀﾞ')).toBe('ヤマダ');
    expect(normalizeKana('ﾊﾟｰｸ')).toBe('パーク');
    expect(normalizeKana('やまだ')).toBe('ヤマダ');
    expect(normalizeKana(' サトウ ')).toBe('サトウ');
  });

  it('番号：ハイフン・空白を取る', () => {
    expect(normalizeDigits('1234-567890')).toBe('1234567890');
    expect(normalizeDigits('１２３４－５６７８９０')).toBe('1234567890');
    expect(normalizeDigits('100 0001')).toBe('1000001');
  });

  it('金額・日数：円・カンマ・日を取る。日数の小数は切り捨て', () => {
    expect(normalizeNumber('300,000円')).toBe('300000');
    expect(normalizeNumber('¥1,200')).toBe('1200');
    expect(normalizeNumber('20日')).toBe('20');
    expect(normalizeDays('20.5')).toBe('20');
    expect(normalizeDays('21')).toBe('21');
  });

  it('氏名を分ける（全角・半角の空白。空白がなければ全部を姓）', () => {
    expect(splitName('山田 太郎')).toEqual(['山田', '太郎']);
    expect(splitName('山田　太郎')).toEqual(['山田', '太郎']);
    expect(splitName('NGUYEN VAN AN')).toEqual(['NGUYEN', 'VAN AN']);
    expect(splitName('山田太郎')).toEqual(['山田太郎', '']);
  });
});

describe('column-map：見出しを当てる', () => {
  it('全角半角・空白・括弧の違いは同じとみなす', () => {
    expect(headerKey('姓（ヨミガナ）')).toBe(headerKey('姓ヨミガナ'));
    expect(headerKey(' 1日の所定労働時間(分) ')).toBe(headerKey('１日の所定労働時間（分）'));
    expect(headerKey('﻿社員番号')).toBe('社員番号');
  });

  it('言い換えの表で当てる。同じ項目に2列当たったら先の列', () => {
    const m = guessMapping(['従業員コード', '氏', '入社年月日', 'メモ', '社員番号'], FIELDS);
    expect(m.no).toEqual({ col: 0 });
    expect(m.name).toEqual({ col: 1 });
    expect(m.hire).toEqual({ col: 2 });
    expect(m.a).toBeUndefined();
  });

  it('うちの見出しそのままか', () => {
    expect(isOurFormat(['社員番号', '入社日', 'AB'], FIELDS)).toBeTrue();
    expect(isOurFormat(['従業員コード', '入社日', 'AB'], FIELDS)).toBeFalse();
  });

  it('必須：結ぶか、全員に同じ値か、計算の元がそろえば足りる', () => {
    expect(missingRequired(FIELDS, {})).toEqual(['no', 'hire', 'ab']);
    expect(missingRequired(FIELDS, { no: { col: 0 }, hire: { fixed: '2026-04-01' }, a: { col: 1 } })).toEqual(['ab']);
    expect(missingRequired(FIELDS, { no: { col: 0 }, hire: { fixed: '' }, a: { col: 1 }, b: { col: 2 } })).toEqual(['hire']);
  });

  it('使っていない列', () => {
    expect(unusedColumns(['a', 'b', '', 'c'], { no: { col: 1 }, hire: { fixed: 'x' } })).toEqual([0, 3]);
  });
});

describe('column-map：うちの表を作る', () => {
  it('見出しをうちの名前に、値を言い直し、全員に同じ値を入れる。空の行は捨てる', () => {
    const table = [
      ['従業員コード', '入社年月日', '氏'],
      ['001', 'R8.4.1', '山田'],
      ['', '', ''],
      ['002', '2026/10/1', '佐藤'],
    ];
    const out = toOurTable(table, { no: { col: 0 }, hire: { col: 1 }, name: { col: 2 }, a: { fixed: 'x' } }, {
      fields: FIELDS,
      out: ['no', 'hire', 'name', 'a', 'b'],
      outHeader: (k) => FIELDS.find((f) => f.key === k)!.header,
    });
    expect(out).toEqual([
      ['社員番号', '入社日', '姓', 'A', 'B'],
      ['001', '2026-04-01', '山田', 'x', ''],
      ['002', '2026-10-01', '佐藤', 'x', ''],
    ]);
  });

  it('finish で項目どうしを計算する', () => {
    const out = toOurTable([['a', 'b'], ['3', '4']], { a: { col: 0 }, b: { col: 1 } }, {
      fields: FIELDS,
      out: ['ab'],
      outHeader: () => 'AB',
      finish: (v) => ({ ...v, ab: String(Number(v.a) * Number(v.b)) }),
    });
    expect(out).toEqual([['AB'], ['12']]);
  });
});

describe('列を足して1つの項目にする（金額の項目だけ。11/24）', () => {
  type K = 'no' | 'fixed' | 'days';
  const fields: ImportField<K>[] = [
    { key: 'no', header: '社員番号', words: [] },
    { key: 'fixed', header: '固定的賃金', words: [], kind: 'number' },
    { key: 'days', header: '支払基礎日数', words: [], kind: 'days' },
  ];
  const spec: OurTableSpec<K, K> = { fields, out: ['no', 'fixed', 'days'], outHeader: (k) => k };
  // 給与ソフトの書き出し：基本給・役職手当・通勤手当・残業手当が別の列
  const table = [
    ['社員番号', '基本給', '役職手当', '通勤手当', '残業手当', '出勤日数'],
    ['0001', '250,000', '30,000', '12,340', '45,000', '21'],
    ['0002', '220,000', '', '8,000', '0', '20'],
    ['0003', '200,000', 'なし', '5,000', '', '19'],
  ];
  const mapping: Mapping<K> = { no: { col: 0 }, fixed: { col: 1, plus: [2, 3] }, days: { col: 5 } };

  it('基本給＋役職手当＋通勤手当 → 固定的賃金（残業手当は足さない）。空のセルは0', () => {
    const out = toOurTable(table, mapping, spec);
    expect(out[1]).toEqual(['0001', '292340', '21']);
    expect(out[2]).toEqual(['0002', '228000', '20']);
  });

  it('数でないセルがあれば足さずにその文字のまま（確認画面のエラーにする）', () => {
    expect(toOurTable(table, mapping, spec)[3][1]).toBe('なし');
  });

  it('全部空なら空（0円にはしない）', () => {
    expect(sumCells(['', ' ', ''])).toBe('');
    expect(sumCells(['1,000円', '２０００'])).toBe('3000');
  });

  it('足した列も「使っている列」に数える', () => {
    expect(unusedColumns(table[0], mapping)).toEqual([4]);
  });

  it('金額でない項目は足さない（日数に plus があっても1列目だけ）', () => {
    const m: Mapping<K> = { ...mapping, days: { col: 5, plus: [1] } };
    expect(toOurTable(table, m, spec)[1][2]).toBe('21');
    expect(canSum(fields[1])).toBeTrue();
    expect(canSum(fields[2])).toBeFalse();
  });
});

describe('割り当てを覚える（見出しの名前で。11/24）', () => {
  type K = 'no' | 'month' | 'cash' | 'fixed' | 'days';
  const fields: ImportField<K>[] = [
    { key: 'no', header: '社員番号', words: [] },
    { key: 'month', header: '支払った月', words: [] },
    { key: 'cash', header: '支払額', words: [], kind: 'number' },
    { key: 'fixed', header: '固定的賃金', words: [], kind: 'number' },
    { key: 'days', header: '支払基礎日数', words: [], kind: 'days' },
  ];
  const oct = ['社員番号', '支給年月', '総支給額', '基本給', '役職手当', '通勤手当', '出勤日数'];
  const m: Mapping<K> = { no: { col: 0 }, month: { col: 1 }, cash: { col: 2 }, fixed: { col: 3, plus: [4, 5] }, days: null };

  it('列は位置ではなく見出しの名前で覚える。「使わない」も覚える', () => {
    expect(toSavedMapping(oct, m)).toEqual({
      no: { col: '社員番号' },
      month: { col: '支給年月' },
      cash: { col: '総支給額' },
      fixed: { col: '基本給', plus: ['役職手当', '通勤手当'] },
      days: null,
    });
  });

  it('翌月のファイルで列の順が変わっても、同じ見出しの列に戻る', () => {
    const nov = ['支給年月', '社員番号', '基本給', '通勤手当', '役職手当', '総支給額', '出勤日数'];
    const back = fromSavedMapping(nov, fields, toSavedMapping(oct, m), { days: { col: 6 } });
    expect(back).toEqual({ no: { col: 1 }, month: { col: 0 }, cash: { col: 5 }, fixed: { col: 2, plus: [4, 3] }, days: null });
  });

  it('見出しが見つからない列は自動で当てた結果に戻し、足した列は見つかるものだけ。覚えていない項目は自動の結果', () => {
    const dec = ['社員番号', '支給年月', '総支給額（円）', '基本給', '通勤手当', '出勤日数'];
    const saved = toSavedMapping(oct, m);
    delete saved['days'];
    const back = fromSavedMapping(dec, fields, saved, { cash: { col: 2 }, days: { col: 5 } });
    expect(back.cash).toEqual({ col: 2 });
    expect(back.fixed).toEqual({ col: 3, plus: [4] });
    expect(back.days).toEqual({ col: 5 });
  });

  it('全角・空白の違いは同じ見出しとみなす。全員に同じ値もそのまま', () => {
    const saved = { no: { col: '社員番号' }, month: { fixed: '2026-10' } };
    const back = fromSavedMapping(['社員 番号', 'ほか'], fields, saved, {});
    expect(back.no).toEqual({ col: 0 });
    expect(back.month).toEqual({ fixed: '2026-10' });
  });
});
