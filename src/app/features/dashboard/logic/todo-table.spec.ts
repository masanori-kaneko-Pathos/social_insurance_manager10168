import { BoardGroup, BoardItem } from './todo-board';
import { daysLeft, deadlineOf, filingDeadline, filterRows, kindsIn, toRows, urgencyOf } from './todo-table';

const item = (p: Partial<BoardItem> & Pick<BoardItem, 'kind' | 'key'>): BoardItem => ({
  employeeId: 'e1', date: null, todo: null, age: null, office: null, ...p,
});

describe('届出の期限（当日から起算して5日以内）', () => {
  it('4月1日なら4月5日まで（当日を1日目に数える）', () => {
    expect(filingDeadline('2026-04-01')).toBe('2026-04-05');
    expect(filingDeadline('2026-04-28')).toBe('2026-05-02'); // 月をまたぐ
  });

  it('取得・区分変更・これから・証明書・協定は、その日から', () => {
    for (const kind of ['acquire', 'categoryChange', 'upcoming', 'certificateEnd', 'agreement'] as const) {
      expect(deadlineOf(item({ kind, key: kind, date: '2026-11-10' })).deadline).toBe('2026-11-14');
    }
  });

  it('喪失（加入の見直し）は日が分からないので「速やかに」', () => {
    expect(deadlineOf(item({ kind: 'lose', key: 'l' }))).toEqual({ deadline: null, note: 'asap' });
  });

  it('70歳は到達日から・報酬が変わるときだけ、75歳は誕生日（喪失日）から、40・65歳はなし', () => {
    const age = (n: 40 | 65 | 70 | 75) =>
      deadlineOf(item({ kind: 'age', key: 'a', age: { age: n, birthday: '2026-12-02', reachDate: '2026-12-01', effectMonth: '2026-12' } }));
    expect(age(70)).toEqual({ deadline: '2026-12-05', note: 'onlyIfPayChanges' });
    expect(age(75)).toEqual({ deadline: '2026-12-06', note: null });
    expect(age(40)).toEqual({ deadline: null, note: null });
    expect(age(65)).toEqual({ deadline: null, note: null });
  });
});

describe('急ぎのバッジ', () => {
  const today = '2026-11-11';
  it('期限から：過ぎた／3日以内／それより先', () => {
    expect(urgencyOf('acquire', '2026-11-10', null, today)).toBe('overdue');
    expect(urgencyOf('acquire', '2026-11-11', null, today)).toBe('now');
    expect(urgencyOf('acquire', '2026-11-14', null, today)).toBe('now');
    expect(urgencyOf('acquire', '2026-11-15', null, today)).toBe('soon');
  });

  it('期限がないときは種類から', () => {
    expect(urgencyOf('lose', null, 'asap', today)).toBe('now');
    expect(urgencyOf('requests', null, null, today)).toBe('now');
    expect(urgencyOf('noContract', null, null, today)).toBe('missing');
    expect(urgencyOf('office', null, null, today)).toBe('missing');
    expect(urgencyOf('age', null, null, today)).toBe('info');
  });

  it('あと何日', () => {
    expect(daysLeft('2026-11-11', today)).toBe(0);
    expect(daysLeft('2026-11-14', today)).toBe(3);
    expect(daysLeft('2026-11-09', today)).toBe(-2);
  });
});

describe('1つの表にする', () => {
  const today = '2026-11-11';
  const groups: BoardGroup[] = [
    { kind: 'acquire', section: 'now', items: [item({ kind: 'acquire', key: 'acq', date: '2026-11-01' })], dismissed: [] },
    { kind: 'lose', section: 'now', items: [item({ kind: 'lose', key: 'lose' })], dismissed: [] },
    {
      kind: 'categoryChange', section: 'soon',
      items: [item({ kind: 'categoryChange', key: 'cc-far', date: '2026-12-20' }), item({ kind: 'categoryChange', key: 'cc-near', date: '2026-11-09' })],
      dismissed: [item({ kind: 'categoryChange', key: 'cc-done', date: '2026-11-20' })],
    },
    { kind: 'noContract', section: 'missing', items: [item({ kind: 'noContract', key: 'nc' })], dismissed: [] },
  ];

  it('急ぐ順（期限切れ → 今すぐ（期限の近い順、期限なしは後ろ）→ 期限が近い → 材料不足）', () => {
    const rows = filterRows(toRows(groups, today), 'open', 'all');
    expect(rows.map((r) => r.item.key)).toEqual(['acq', 'cc-near', 'lose', 'cc-far', 'nc']);
    expect(rows.map((r) => r.urgency)).toEqual(['overdue', 'now', 'now', 'soon', 'missing']);
  });

  it('未対応／確認済み・種類で絞る', () => {
    const rows = toRows(groups, today);
    expect(filterRows(rows, 'dismissed', 'all').map((r) => r.item.key)).toEqual(['cc-done']);
    expect(filterRows(rows, 'open', 'categoryChange').map((r) => r.item.key)).toEqual(['cc-near', 'cc-far']);
  });

  it('プルダウンの種類は、表にあるものだけ・決まった順', () => {
    expect(kindsIn(toRows(groups, today), ['noContract', 'acquire', 'age', 'lose', 'categoryChange'])).toEqual([
      'noContract', 'acquire', 'lose', 'categoryChange',
    ]);
  });
});

describe('契約の満了の期限と急ぎ', () => {
  const item = (date: string, noticeBy: string) =>
    ({
      key: 'k',
      kind: 'contractEnd',
      employeeId: 'e1',
      date,
      todo: null,
      age: null,
      office: null,
      extra: { kind: 'contractEnd', employeeId: 'e1', date, params: { date, notice: noticeBy ? 'yes' : 'no', noticeBy, shortTerm: 'no' } },
    }) as BoardItem;

  it('予告が要る人は満了の30日前、ほかは満了日が期限', () => {
    expect(deadlineOf(item('2026-12-31', '2026-12-01')).deadline).toBe('2026-12-01');
    expect(deadlineOf(item('2026-12-31', '')).deadline).toBe('2026-12-31');
  });
  it('満了の30日前からは「今すぐ」、それより前は「もうすぐ」', () => {
    expect(urgencyOf('contractEnd', '2026-12-31', null, '2026-12-01', '2026-12-31')).toBe('now');
    expect(urgencyOf('contractEnd', '2026-12-31', null, '2026-11-30', '2026-12-31')).toBe('soon');
  });
});

describe('届出の宿題の期限', () => {
  it('事業所の変更は変わった日を1日目に5日、住所変更は速やかに', () => {
    expect(deadlineOf(item({ kind: 'officeNameAddress', key: 'k', date: '2026-11-12' })).deadline).toBe('2026-11-16');
    expect(deadlineOf(item({ kind: 'address', key: 'k', date: '2026-11-12' })).note).toBe('asap');
  });
});
