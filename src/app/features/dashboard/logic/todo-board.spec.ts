import type { Classification } from '../../employees/logic/classify';
import {
  activeDismissals,
  ageItems,
  groupBoard,
  GROUP_LIMIT,
  officeItem,
  openCount,
  requestsItem,
  todoItem,
  todoKey,
  visibleOf,
} from './todo-board';
import { Todo, TodoKind } from './todos';

const C: Classification = { category: 'regular', reason: 'threeQuarters', contractFrom: null, below: null, nums: null };
const todo = (kind: TodoKind, id: string, date: string | null = null): Todo => ({
  kind,
  employeeId: id,
  today: C,
  date,
  next: null,
});
const on = (d: string) => ({ enrolled: true, acquiredDate: d, lostDate: null });

describe('todoKey：日付を鍵に入れる', () => {
  it('種類・人・日付', () => {
    expect(todoKey(todo('categoryChange', 'A', '2026-12-01'))).toBe('categoryChange:A:2026-12-01');
    expect(todoKey(todo('noContract', 'A'))).toBe('noContract:A:-');
  });
});

describe('groupBoard：種類ごとに、急ぐ順', () => {
  it('並びは 今すぐ → 期限が近い → 材料不足。空のまとまりは出さない', () => {
    const items = [
      officeItem('noStandard'),
      todoItem(todo('upcoming', 'A', '2026-12-01')),
      todoItem(todo('acquire', 'B', '2026-10-01')),
      requestsItem(),
    ];
    const g = groupBoard(items, new Set());
    expect(g.map((x) => [x.kind, x.section])).toEqual([
      ['acquire', 'now'],
      ['requests', 'now'],
      ['upcoming', 'soon'],
      ['office', 'missing'],
    ]);
  });
  it('確認済みは、消せる種類だけ dismissed に移る（取得届は消せない）', () => {
    const up = todoItem(todo('upcoming', 'A', '2026-12-01'));
    const acq = todoItem(todo('acquire', 'B', '2026-10-01'));
    const g = groupBoard([up, acq], new Set([up.key, acq.key]));
    expect(g.find((x) => x.kind === 'upcoming')?.items).toEqual([]);
    expect(g.find((x) => x.kind === 'upcoming')?.dismissed.length).toBe(1);
    expect(g.find((x) => x.kind === 'acquire')?.items.length).toBe(1);
    expect(openCount(g)).toBe(1);
  });
});

describe('visibleOf：5件まで＋あと○件', () => {
  const many = Array.from({ length: 7 }, (_, i) => todoItem(todo('acquire', `E${i}`, '2026-10-01')));
  const [g] = groupBoard(many, new Set());
  it('閉じているときは5件', () => {
    const v = visibleOf(g, false);
    expect(v.shown.length).toBe(GROUP_LIMIT);
    expect(v.rest).toBe(2);
  });
  it('開いたら全部', () => {
    expect(visibleOf(g, true)).toEqual({ shown: many, rest: 0 });
  });
  it('5件以下なら「あと」はない', () => {
    const [small] = groupBoard(many.slice(0, 3), new Set());
    expect(visibleOf(small, false).rest).toBe(0);
  });
});

describe('activeDismissals', () => {
  it('until が null ならずっと、日付ならその日まで', () => {
    const s = activeDismissals(
      [
        { key: 'a', until: null },
        { key: 'b', until: '2026-11-10' },
        { key: 'c', until: '2026-11-09' },
      ],
      '2026-11-10',
    );
    expect([...s]).toEqual(['a', 'b']);
  });
});

describe('ageItems：今月と来月の年齢到達', () => {
  const people = [
    // 75歳の誕生日 2026-12-05（健保の喪失）
    { id: 'H', birthDate: '1951-12-05', retireDate: null, health: on('2018-04-01'), pension: on('2018-04-01') },
    // 40歳の到達日 2026-11-19（介護の始まり）
    { id: 'B', birthDate: '1986-11-20', retireDate: null, health: on('2025-04-01'), pension: on('2025-04-01') },
    // 退職した人は出さない
    { id: 'R', birthDate: '1986-11-21', retireDate: '2026-10-31', health: on('2025-04-01'), pension: on('2025-04-01') },
  ];
  it('影響が出る月の順。鍵は age:人:年齢', () => {
    const items = ageItems(people, '2026-11', '2026-12', '2026-11-10');
    expect(items.map((i) => [i.key, i.date])).toEqual([
      ['age:B:40', '2026-11-20'],
      ['age:H:75', '2026-12-05'],
    ]);
  });
});
