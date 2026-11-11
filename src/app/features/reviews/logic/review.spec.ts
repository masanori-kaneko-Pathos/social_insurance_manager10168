import { canCheck, canRequest, filingReviewId, noticeReviewId, reviewState } from './review';

describe('review：ダブルチェック', () => {
  it('状態', () => {
    expect(reviewState(null)).toBe('none');
    expect(reviewState({ requestedBy: 'A', checkedBy: null })).toBe('requested');
    expect(reviewState({ requestedBy: 'A', checkedBy: 'B' })).toBe('checked');
  });
  it('頼んだ本人は確認できない。別の人なら確認できる', () => {
    const r = { requestedBy: 'A', checkedBy: null };
    expect(canCheck(r, 'A')).toBeFalse();
    expect(canCheck(r, 'B')).toBeTrue();
    expect(canCheck({ ...r, checkedBy: 'B' }, 'C')).toBeFalse();
    expect(canCheck(null, 'B')).toBeFalse();
    expect(canCheck(r, null)).toBeFalse();
  });
  it('頼めるのは管理者で、まだ頼んでいないとき', () => {
    expect(canRequest(null, true)).toBeTrue();
    expect(canRequest(null, false)).toBeFalse();
    expect(canRequest({ requestedBy: 'A', checkedBy: null }, true)).toBeFalse();
  });
  it('鍵', () => {
    expect(filingReviewId('acquire', '2026-10_2026-11')).toBe('filing_acquire_2026-10_2026-11');
    expect(noticeReviewId('2026-10')).toBe('notice_2026-10');
  });
});
