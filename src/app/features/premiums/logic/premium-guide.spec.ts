import { premiumGuideSteps, PremiumGuideInput } from './premium-guide';

const base: PremiumGuideInput = {
  close: null,
  fixCount: 0,
  softNow: null,
  noticeSaved: false,
  noticeStatus: 'notEntered',
  noticeHasReason: false,
};
const states = (x: Partial<PremiumGuideInput>) => premiumGuideSteps({ ...base, ...x }).map((s) => s.state);

describe('保険料のページの業務の順の案内（11/26）', () => {
  it('はじめは全部「まだ」。先に直す人がいれば①は要確認', () => {
    expect(states({})).toEqual(['todo', 'todo', 'todo', 'todo']);
    const s = premiumGuideSteps({ ...base, fixCount: 3 })[0];
    expect(s.state).toBe('attention');
    expect(s.noteParams).toEqual({ count: 3 });
  });

  it('照合：差がある人がいれば要確認、全員一致なら済み（確認済みにする前は今の画面の結果）', () => {
    expect(states({ softNow: { matched: 48, diff: 2 } })[1]).toBe('attention');
    expect(states({ softNow: { matched: 50, diff: 0 } })[1]).toBe('done');
  });

  it('確認済み：①③は済み。照合は記録した結果（照合なしで確認済みなら「していない」）', () => {
    expect(states({ close: { softCheck: { matched: 50, diff: 0 } } })).toEqual(['done', 'done', 'done', 'todo']);
    expect(states({ close: { softCheck: null } })[1]).toBe('skipped');
    expect(states({ close: {} })[1]).toBe('skipped'); // 前のデータ（softCheck がない）
    // 確認済みの後に読んだファイルではなく、記録した結果で決める
    expect(states({ close: { softCheck: null }, softNow: { matched: 50, diff: 0 } })[1]).toBe('skipped');
  });

  it('告知額：保存するまでは「まだ」。差があれば理由を記録して済み', () => {
    expect(states({ noticeStatus: 'match' })[3]).toBe('todo'); // 入れただけで保存していない
    expect(states({ noticeSaved: true, noticeStatus: 'match' })[3]).toBe('done');
    expect(states({ noticeSaved: true, noticeStatus: 'diff' })[3]).toBe('attention');
    expect(states({ noticeSaved: true, noticeStatus: 'diff', noticeHasReason: true })[3]).toBe('done');
  });
});
