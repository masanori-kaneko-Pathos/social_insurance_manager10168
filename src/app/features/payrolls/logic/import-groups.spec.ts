import { blockedLines, groupByPerson, GroupItem, GroupSourceRow, IssuePerson } from './import-groups';

const item = (line: number, employeeId: string, paidMonth: string, cash: number): GroupItem => ({
  line, employeeId, paidMonth, input: { cash },
});
const ok = (it: GroupItem): GroupSourceRow<GroupItem> => ({ line: it.line, item: it, issue: null });
const bad = (line: number): GroupSourceRow<GroupItem> => ({ line, item: null, issue: { line } });

describe('groupByPerson（給与の取り込みを1人1行に。11/28）', () => {
  const NO: Record<string, string> = { a: '0002', b: '0010', c: '0001' };
  const persons: Record<number, IssuePerson> = {
    20: { employeeId: 'b', fileKey: '0010', paidMonth: '2026-03' },
    30: { employeeId: null, fileKey: 'E998', paidMonth: '2026-04' },
    31: { employeeId: null, fileKey: 'E998', paidMonth: null },
  };
  const rows: GroupSourceRow<GroupItem>[] = [
    ok(item(2, 'a', '2026-05', 300000)),
    ok(item(3, 'a', '2026-04', 300000)),
    ok(item(10, 'b', '2026-04', 200000)),
    bad(20),
    ok(item(40, 'c', '2026-04', 100000)),
    bad(30),
    bad(31),
  ];
  const groups = groupByPerson(rows, (l) => persons[l], (it) => it.line === 2, (id) => NO[id]);

  it('人ごとにまとめ、月の数・最初と最後の月・合計・上書きの数を出す', () => {
    const a = groups.find((g) => g.employeeId === 'a')!;
    expect(a.monthCount).toBe(2);
    expect([a.firstMonth, a.lastMonth]).toEqual(['2026-04', '2026-05']);
    expect(a.cash).toBe(600000);
    expect(a.updated).toBe(1);
    expect(a.lines).toEqual([3, 2]); // 月の順
  });
  it('問題の行も、決まった人の行に入れる。決まらない人はファイルの値でまとめる', () => {
    const b = groups.find((g) => g.employeeId === 'b')!;
    expect(b.errors).toBe(1);
    expect(b.lines).toEqual([20, 10]); // 3月（問題の行）→ 4月
    const unknown = groups.find((g) => g.key === 'f:E998')!;
    expect(unknown.lines).toEqual([30, 31]); // 月が読めない行は最後
    expect(unknown.errors).toBe(2);
  });
  it('エラーのある人を上に、そのあとは社員番号の順', () => {
    expect(groups.map((g) => g.key)).toEqual(['e:b', 'f:E998', 'e:c', 'e:a']);
  });
  it('blockedLines：エラーのある人の、エラーでない行は取り込まない', () => {
    const items = rows.filter((r) => r.item).map((r) => r.item!);
    expect([...blockedLines(items, ['b', null, undefined])]).toEqual([10]);
    expect(blockedLines(items, []).size).toBe(0);
  });
});
