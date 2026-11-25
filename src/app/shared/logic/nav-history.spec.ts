import { NavEntry, nameEntry, previousOf, pushEntry } from './nav-history';

const e = (path: string, q = ''): NavEntry => ({ path, url: path + q, name: { key: 'back.' + path.split('/').pop() } });
const run = (...xs: NavEntry[]) => xs.reduce<NavEntry[]>((s, x) => pushEntry(s, x), []);

describe('アプリの中の前の画面（11/25）', () => {
  it('順に積み、前の画面は1つ前', () => {
    const s = run(e('/o/1'), e('/o/1/payrolls/2026-07'), e('/o/1/employees/a'));
    expect(previousOf(s, '/o/1/employees/a')?.path).toBe('/o/1/payrolls/2026-07');
  });
  it('タブ・絞り込みの切り替え（同じパス）は上書き。戻ると最後のタブで開く', () => {
    const s = run(e('/o/1/employees'), e('/o/1/employees/a'), e('/o/1/employees/a', '?tab=pay'), e('/o/1/payrolls'));
    expect(s.length).toBe(3);
    expect(previousOf(s, '/o/1/payrolls')?.url).toBe('/o/1/employees/a?tab=pay');
  });
  it('前に見た画面に戻ったら、そこから後ろは捨てる（行ったり来たりで輪にならない）', () => {
    const s = run(e('/o/1'), e('/o/1/employees'), e('/o/1/employees/a'), e('/o/1/employees'));
    expect(s.map((x) => x.path)).toEqual(['/o/1', '/o/1/employees']);
    expect(previousOf(s, '/o/1/employees')?.path).toBe('/o/1');
  });
  it('積まない画面（編集）では、いちばん上が前の画面。保存して詳細に戻っても、編集画面は出てこない', () => {
    const s = run(e('/o/1/employees'), e('/o/1/employees/a'));
    expect(previousOf(s, '/o/1/employees/a/edit')?.path).toBe('/o/1/employees/a');
    const after = pushEntry(s, e('/o/1/employees/a'));
    expect(previousOf(after, '/o/1/employees/a')?.path).toBe('/o/1/employees');
  });
  it('前の画面がない（直接開いた・再読み込み）ときは null', () => {
    expect(previousOf([], '/o/1/employees/a')).toBeNull();
    expect(previousOf(run(e('/o/1/employees/a')), '/o/1/employees/a')).toBeNull();
  });
  it('画面が後から決めた名前（氏名）は、タブを変えても残る', () => {
    let s = run(e('/o/1/employees/a'));
    s = nameEntry(s, '/o/1/employees/a', '山田 太郎');
    s = pushEntry(s, e('/o/1/employees/a', '?tab=pay'));
    expect(s[0].text).toBe('山田 太郎');
  });
});
