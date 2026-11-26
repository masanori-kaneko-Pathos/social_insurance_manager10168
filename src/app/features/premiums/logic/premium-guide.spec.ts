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

  it('確認済みの注記に、誰が・いつ（記録にあれば。11/26）', () => {
    const [e, , t] = premiumGuideSteps({ ...base, close: { softCheck: null, closedByName: '金子', closedOn: '11/26' } });
    expect(e.noteKey).toBe('premiumGuide.note.checkedBy');
    expect(e.noteParams).toEqual({ name: '金子', date: '11/26' });
    expect(t.noteKey).toBe('premiumGuide.note.checkedBy');
    expect(premiumGuideSteps({ ...base, close: { softCheck: null } })[0].noteKey).toBe('premiumGuide.note.checked');
  });

  it('告知額は、別の人が確認して済み（頼んでいない・確認待ちは「まだ」。11/26）', () => {
    const saved = { ...base, noticeSaved: true, noticeStatus: 'match' as const };
    const s = (x: Partial<PremiumGuideInput>) => premiumGuideSteps({ ...saved, ...x })[3];
    expect(s({ noticeReview: null }).state).toBe('todo');
    expect(s({ noticeReview: null }).noteKey).toBe('premiumGuide.note.noticeAsk');
    const waiting = s({ noticeReview: { requestedByName: '金子', checkedByName: null, checkedOn: null } });
    expect(waiting.state).toBe('todo');
    expect(waiting.noteParams).toEqual({ name: '金子' });
    const checked = s({ noticeReview: { requestedByName: '金子', checkedByName: '佐藤', checkedOn: '11/27' } });
    expect(checked.state).toBe('done');
    expect(checked.noteParams).toEqual({ name: '佐藤', date: '11/27' });
    // メンバーが1人なら、保存で済み
    expect(s({ noticeReview: null, solo: true }).state).toBe('done');
    // 差の理由がないうちは、確認の前に要確認
    expect(s({ noticeStatus: 'diff', noticeReview: null }).state).toBe('attention');
  });
});
