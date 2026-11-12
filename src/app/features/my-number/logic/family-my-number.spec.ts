import { attachOmission, familyDisposalDate, spouseVerifyWarning } from './family-my-number';

describe('attachOmission：続柄の書類を省けるか', () => {
  it('本人の番号・家族の番号・続柄の確認の3つがそろえば省ける', () => {
    expect(attachOmission('registered', { status: 'registered' }, true)).toEqual({ ok: true, missing: [] });
  });

  it('足りないものを返す（チェック待ちは、まだそろっていない）', () => {
    expect(attachOmission('submitted', { status: 'submitted' }, false).missing).toEqual([
      'selfNumber',
      'familyNumber',
      'relationship',
    ]);
    expect(attachOmission('registered', null, true).missing).toEqual(['familyNumber']);
  });
});

describe('spouseVerifyWarning：配偶者の本人確認', () => {
  it('配偶者で、従業員が確認したときだけ注意', () => {
    expect(spouseVerifyWarning('spouse', { verifiedBy: 'employee' })).toBeTrue();
    expect(spouseVerifyWarning('spouse', { verifiedBy: 'employer' })).toBeFalse();
    expect(spouseVerifyWarning('child', { verifiedBy: 'employee' })).toBeFalse();
    expect(spouseVerifyWarning('spouse', null)).toBeFalse();
  });
});

describe('familyDisposalDate：扶養を外れてから2年', () => {
  it('番号があって、外れた日があるときだけ', () => {
    expect(familyDisposalDate('2025-03-31', { status: 'registered' })).toBe('2027-03-31');
    expect(familyDisposalDate(null, { status: 'registered' })).toBeNull();
    expect(familyDisposalDate('2025-03-31', { status: 'refused' })).toBeNull();
    expect(familyDisposalDate('2024-02-29', { status: 'submitted' })).toBe('2026-03-01');
  });
});
