// 従業員マイページの状態（一覧と一括招待で使う）
// Angular・Firebase に依存しない純粋な関数

import { inviteState } from './invite';

/** linked：アカウントあり／invited：使える招待あり／expired：招待が期限切れだけ／none：招待なし */
export type MyPageStatus = 'linked' | 'invited' | 'expired' | 'none';

/** 判定に使う招待の形（Invite の Timestamp をミリ秒にしたもの） */
export interface InviteLike {
  code: string;
  employeeId: string | null;
  email: string | null;
  usedBy: string | null;
  expiresMs: number;
}

export interface MyPageEmployee {
  id: string;
  userUid?: string | null;
  contact?: { email: string | null } | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 連絡先のメール（形が正しいときだけ。小文字にそろえる） */
export function contactEmailOf(e: MyPageEmployee): string | null {
  const v = e.contact?.email?.trim() ?? '';
  return EMAIL_RE.test(v) ? v.toLowerCase() : null;
}

/** その人の使える招待（いちばん期限の遅いもの） */
export function usableInviteOf(
  employeeId: string,
  invites: readonly InviteLike[],
  nowMs: number,
): InviteLike | null {
  let best: InviteLike | null = null;
  for (const i of invites) {
    if (i.employeeId !== employeeId) continue;
    if (inviteState(i, nowMs) !== 'usable') continue;
    if (!best || i.expiresMs > best.expiresMs) best = i;
  }
  return best;
}

export function myPageStatus(e: MyPageEmployee, invites: readonly InviteLike[], nowMs: number): MyPageStatus {
  if (e.userUid) return 'linked';
  if (usableInviteOf(e.id, invites, nowMs)) return 'invited';
  return invites.some((i) => i.employeeId === e.id && !i.usedBy) ? 'expired' : 'none';
}

/**
 * まとめて招待の対象に選べるか：アカウントがなく、使える招待もない
 * （連絡先のメールは鍵付きの文書にあるので、一覧では読まない。招待を作るときに、選んだ人の分だけ読む）
 */
export function canBulkInvite(e: MyPageEmployee, invites: readonly InviteLike[], nowMs: number): boolean {
  const s = myPageStatus(e, invites, nowMs);
  return s === 'none' || s === 'expired';
}

/** 選んだ人を「招待する人」と「アドレスがなくて飛ばす人」に分ける（アカウントあり・招待中は数えない） */
export function splitForInvite<T extends MyPageEmployee>(
  selected: readonly T[],
  invites: readonly InviteLike[],
  nowMs: number,
): { invite: T[]; noEmail: T[] } {
  const invite: T[] = [];
  const noEmail: T[] = [];
  for (const e of selected) {
    const s = myPageStatus(e, invites, nowMs);
    if (s === 'linked' || s === 'invited') continue;
    (contactEmailOf(e) ? invite : noEmail).push(e);
  }
  return { invite, noEmail };
}
