import { BoardItem, groupBoard, mergedKey, mergeSameDay, extraItem } from './todo-board';

const report = (kind: 'acquireReport' | 'lossReport' | 'dependentReport', id: string, date: string): BoardItem =>
  extraItem({ kind, employeeId: id, date, params: { date } });

describe('mergeSameDay（同じ日の届を1行にまとめる）', () => {
  it('同じ日に2人以上なら1行。1人だけの日はそのまま', () => {
    const out = mergeSameDay([
      report('acquireReport', 'a', '2026-11-16'),
      report('acquireReport', 'b', '2026-11-02'),
      report('acquireReport', 'c', '2026-11-16'),
      report('acquireReport', 'd', '2026-11-16'),
    ]);
    expect(out.length).toBe(2);
    expect(out[0].key).toBe(mergedKey('acquireReport', '2026-11-16'));
    expect(out[0].employeeId).toBe(null);
    expect(out[0].members!.map((m) => m.employeeId)).toEqual(['a', 'c', 'd']);
    expect(out[0].extra!.params).toEqual({ date: '2026-11-16', count: 3 });
    expect(out[1].employeeId).toBe('b');
    expect(out[1].members ?? null).toBe(null);
  });

  it('まとめた行の中の人は、それぞれ自分の「確認した」の鍵を持つ', () => {
    const out = mergeSameDay([report('lossReport', 'a', '2026-11-01'), report('lossReport', 'b', '2026-11-01')]);
    expect(out[0].members!.map((m) => m.key)).toEqual(['lossReport:a:2026-11-01', 'lossReport:b:2026-11-01']);
  });
});

describe('groupBoard でのまとめ方', () => {
  it('確認済みにした人はまとめに入らず、残りが1人ならまとめない', () => {
    const groups = groupBoard(
      [report('acquireReport', 'a', '2026-11-16'), report('acquireReport', 'b', '2026-11-16')],
      new Set(['acquireReport:a:2026-11-16']),
    );
    const g = groups.find((x) => x.kind === 'acquireReport')!;
    expect(g.items.map((i) => i.key)).toEqual(['acquireReport:b:2026-11-16']);
    expect(g.dismissed.map((i) => i.key)).toEqual(['acquireReport:a:2026-11-16']);
  });

  it('あとから同じ日の人を登録したら、その人だけが残る（前の人の確認済みはそのまま）', () => {
    const groups = groupBoard(
      [
        report('acquireReport', 'a', '2026-11-16'),
        report('acquireReport', 'b', '2026-11-16'),
        report('acquireReport', 'c', '2026-11-16'),
      ],
      new Set(['acquireReport:a:2026-11-16', 'acquireReport:b:2026-11-16']),
    );
    expect(groups.find((x) => x.kind === 'acquireReport')!.items.map((i) => i.employeeId)).toEqual(['c']);
  });

  it('被扶養者届も同じ日にまとめる。まとめない種類（賞与支払届など）はそのまま', () => {
    const groups = groupBoard(
      [
        report('dependentReport', 'a', '2026-11-16'),
        report('dependentReport', 'b', '2026-11-16'),
        extraItem({ kind: 'residence', employeeId: 'x', date: '2026-12-01', params: {} }),
        extraItem({ kind: 'residence', employeeId: 'y', date: '2026-12-01', params: {} }),
      ],
      new Set(),
    );
    expect(groups.find((x) => x.kind === 'dependentReport')!.items.length).toBe(1);
    expect(groups.find((x) => x.kind === 'residence')!.items.length).toBe(2);
  });
});
