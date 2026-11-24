import { ExportColumn, exportTable, groupsOf, knownPicks, movePick, picksOf } from './export-table';

interface Row {
  no: string;
  name: string;
  yen: number;
}
const catalog: ExportColumn<Row>[] = [
  { key: 'no', label: '社員番号', group: '人', value: (r) => r.no },
  { key: 'name', label: '氏名', group: '人', value: (r) => r.name },
  { key: 'yen', label: '本人負担', group: '保険料', value: (r) => String(r.yen) },
];
const rows: Row[] = [
  { no: '0001', name: '山田 太郎', yen: 45408 },
  { no: '0002', name: '佐藤 花子', yen: 14700 },
];

describe('出力の窓口：選んだ列で表を作る（11/24）', () => {
  it('選んだ順に列を並べ、見出しは書き換えたもの（なければ目録の名前）', () => {
    const t = exportTable(rows, catalog, [
      { key: 'yen', header: '控除額' },
      { key: 'no', header: null },
    ]);
    expect(t).toEqual([
      ['控除額', '社員番号'],
      ['45408', '0001'],
      ['14700', '0002'],
    ]);
  });

  it('見出しが空白だけなら目録の名前。目録にない鍵は飛ばす', () => {
    const t = exportTable(rows, catalog, [{ key: 'name', header: '  ' }, { key: 'gone', header: 'なくなった項目' }]);
    expect(t[0]).toEqual(['氏名']);
    expect(knownPicks([{ key: 'gone', header: null }, { key: 'no', header: null }], catalog)).toEqual([{ key: 'no', header: null }]);
  });

  it('並べ替え：上へ・下へ。端では動かない', () => {
    const p = picksOf(['no', 'name', 'yen']);
    expect(movePick(p, 2, -1).map((x) => x.key)).toEqual(['no', 'yen', 'name']);
    expect(movePick(p, 0, -1).map((x) => x.key)).toEqual(['no', 'name', 'yen']);
    expect(movePick(p, 2, 1).map((x) => x.key)).toEqual(['no', 'name', 'yen']);
  });

  it('まとまりごとに分ける（目録の順のまま）', () => {
    expect(groupsOf(catalog).map((g) => [g.group, g.columns.map((c) => c.key)])).toEqual([
      ['人', ['no', 'name']],
      ['保険料', ['yen']],
    ]);
  });
});
