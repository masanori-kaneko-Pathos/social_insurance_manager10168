import {
  canBulkInvite,
  contactEmailOf,
  InviteLike,
  myPageStatus,
  splitForInvite,
  usableInviteOf,
} from './my-page-status';

const NOW = 1_000_000;
const inv = (p: Partial<InviteLike>): InviteLike => ({
  code: 'c',
  employeeId: 'e1',
  email: null,
  usedBy: null,
  expiresMs: NOW + 1000,
  ...p,
});

describe('my-page-status', () => {
  it('contactEmailOf: 形が正しいアドレスだけ（小文字に）', () => {
    expect(contactEmailOf({ id: 'a', contact: { email: ' Taro@Example.com ' } })).toBe('taro@example.com');
    expect(contactEmailOf({ id: 'a', contact: { email: 'taro' } })).toBeNull();
    expect(contactEmailOf({ id: 'a', contact: null })).toBeNull();
    expect(contactEmailOf({ id: 'a' })).toBeNull();
  });

  it('myPageStatus: アカウント → 使える招待 → 期限切れ → なし', () => {
    expect(myPageStatus({ id: 'e1', userUid: 'u' }, [inv({})], NOW)).toBe('linked');
    expect(myPageStatus({ id: 'e1' }, [inv({})], NOW)).toBe('invited');
    expect(myPageStatus({ id: 'e1' }, [inv({ expiresMs: NOW })], NOW)).toBe('expired');
    expect(myPageStatus({ id: 'e1' }, [inv({ employeeId: 'e2' })], NOW)).toBe('none');
    // 使われた招待（あとでアカウントが消えた）は期限切れに数えない
    expect(myPageStatus({ id: 'e1' }, [inv({ usedBy: 'u' })], NOW)).toBe('none');
  });

  it('usableInviteOf: いちばん期限の遅いもの', () => {
    const a = inv({ code: 'a', expiresMs: NOW + 10 });
    const b = inv({ code: 'b', expiresMs: NOW + 20 });
    expect(usableInviteOf('e1', [a, b, inv({ code: 'x', expiresMs: NOW - 1 })], NOW)?.code).toBe('b');
    expect(usableInviteOf('e2', [a, b], NOW)).toBeNull();
  });

  it('canBulkInvite: アカウントも使える招待もない人だけ（期限切れは選べる）', () => {
    expect(canBulkInvite({ id: 'e1' }, [], NOW)).toBeTrue();
    expect(canBulkInvite({ id: 'e1' }, [inv({ expiresMs: NOW - 1 })], NOW)).toBeTrue();
    expect(canBulkInvite({ id: 'e1' }, [inv({})], NOW)).toBeFalse();
    expect(canBulkInvite({ id: 'e1', userUid: 'u' }, [], NOW)).toBeFalse();
  });

  it('splitForInvite: アドレスのない人を分け、アカウントあり・招待中は外す', () => {
    const list = [
      { id: 'a', contact: { email: 'a@b.jp' } },
      { id: 'b', contact: { email: null } },
      { id: 'c', contact: { email: 'c@b.jp' }, userUid: 'u' },
      { id: 'e1', contact: { email: 'e@b.jp' } },
    ];
    const r = splitForInvite(list, [inv({})], NOW);
    expect(r.invite.map((e) => e.id)).toEqual(['a']);
    expect(r.noEmail.map((e) => e.id)).toEqual(['b']);
  });
});
