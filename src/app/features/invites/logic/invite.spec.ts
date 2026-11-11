import { emailMatches, inviteState, inviteUrl, isInviteCode, joinUrl, makeInviteCode } from './invite';

describe('makeInviteCode', () => {
  it('24文字の英数字', () => {
    let seed = 1;
    const random = (n: number) => Uint8Array.from({ length: n }, () => (seed = (seed * 73 + 41) % 256));
    const code = makeInviteCode(random);
    expect(code.length).toBe(24);
    expect(isInviteCode(code)).toBeTrue();
  });

  it('248 以上の乱数は捨てる（かたよらないように）', () => {
    let calls = 0;
    // 1回目は全部 255（捨てる）、2回目は 0, 1, 2 … → 'A', 'B', 'C' …
    const random = (n: number) => {
      calls++;
      return calls === 1 ? new Uint8Array(n).fill(255) : Uint8Array.from({ length: n }, (_, i) => i);
    };
    expect(makeInviteCode(random, 5)).toBe('ABCDE');
    expect(calls).toBe(2);
  });
});

describe('inviteState・emailMatches・inviteUrl', () => {
  it('使った・期限切れ・使える', () => {
    expect(inviteState({ usedBy: 'u1', expiresMs: 0 }, 100)).toBe('used');
    expect(inviteState({ usedBy: null, expiresMs: 100 }, 100)).toBe('expired');
    expect(inviteState({ usedBy: null, expiresMs: 101 }, 100)).toBe('usable');
  });

  it('メールは決めていなければ誰でも。大文字小文字は区別しない', () => {
    expect(emailMatches(null, 'a@example.com')).toBeTrue();
    expect(emailMatches('A@Example.com', 'a@example.com ')).toBeTrue();
    expect(emailMatches('b@example.com', 'a@example.com')).toBeFalse();
  });

  it('リンク', () => {
    expect(inviteUrl('https://x.web.app', 'off1', 'ABC')).toBe('https://x.web.app/invite/off1/ABC');
  });

  it('コードの形', () => {
    expect(isInviteCode('short')).toBeFalse();
    expect(isInviteCode('ABCDEFGHIJKLMNOPQRSTUVW!')).toBeFalse();
  });
});

describe('joinUrl', () => {
  it('メンバーの招待は /join（従業員の /invite と分ける）', () => {
    expect(joinUrl('https://x.web.app', 'off1', 'A'.repeat(24))).toBe(`https://x.web.app/join/off1/${'A'.repeat(24)}`);
  });
});
