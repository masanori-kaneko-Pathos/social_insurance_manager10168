// 招待（従業員のマイページ）
// Angular・Firebase に依存しない純粋な関数
//
// 招待コードは「合鍵」：コードを知っている人だけが、その従業員としてアカウントを作れる。
// 推測されないよう、62種類の文字を24文字（約143ビット）。かたよりが出ないよう、使えない乱数は捨てて引き直す。

export const INVITE_CODE_LENGTH = 24;
export const INVITE_DAYS = 14;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** random(n) は 0〜255 の乱数を n 個返す関数（ブラウザでは crypto.getRandomValues） */
export function makeInviteCode(random: (n: number) => Uint8Array, length = INVITE_CODE_LENGTH): string {
  let out = '';
  while (out.length < length) {
    for (const b of random(length * 2)) {
      if (b >= 248) continue; // 248 ＝ 62 × 4。これ以上は捨てる（62で割った余りがかたよらないように）
      out += ALPHABET[b % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

export function isInviteCode(s: string): boolean {
  return new RegExp(`^[A-Za-z0-9]{${INVITE_CODE_LENGTH}}$`).test(s);
}

export type InviteState = 'usable' | 'used' | 'expired';

export function inviteState(i: { usedBy: string | null; expiresMs: number }, nowMs: number): InviteState {
  if (i.usedBy) return 'used';
  return i.expiresMs <= nowMs ? 'expired' : 'usable';
}

/** 事業所のメンバー（管理者・一般）への招待のリンク。従業員の招待（/invite）と URL で分ける（開いた時点で種類が分かるように） */
export function joinUrl(origin: string, officeId: string, code: string): string {
  return `${origin}/join/${encodeURIComponent(officeId)}/${code}`;
}

/** 招待のリンク */
export function inviteUrl(origin: string, officeId: string, code: string): string {
  return `${origin}/invite/${encodeURIComponent(officeId)}/${code}`;
}

/** 招待で決めたメールアドレスと、作ろうとしているアカウントのメールが合うか（決めていなければ誰でも） */
export function emailMatches(inviteEmail: string | null, email: string): boolean {
  return !inviteEmail || inviteEmail.trim().toLowerCase() === email.trim().toLowerCase();
}
