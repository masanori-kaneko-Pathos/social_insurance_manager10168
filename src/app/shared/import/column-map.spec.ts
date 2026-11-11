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
