import { Injectable } from '@angular/core';
import { collection, deleteDoc, doc, query, serverTimestamp, setDoc, Timestamp, where } from 'firebase/firestore';
import { countedGetDoc, countedGetDocs } from '../../core/read-meter';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../../core/firebase';
import { OfficeRole } from '../../core/models/office';
import { Invite, InviteDoc } from '../../core/models/office-records';
import { INVITE_DAYS, inviteState, makeInviteCode } from '../invites/logic/invite';

/** メンバーへの操作（決まりは functions/src/member-rules.ts。画面は関数が返す actions のボタンだけ出す） */
export type MemberAction = 'promote' | 'demote' | 'remove' | 'transfer';

export interface MemberView {
  uid: string;
  name: string;
  email: string;
  role: OfficeRole;
  owner: boolean; // 代表
  me: boolean;
  actions: MemberAction[];
}

/** 関数が断った理由（翻訳キーの最後の部分）。分からなければ 'unknown' */
export function reasonOf(err: unknown): string {
  const r = (err as { details?: { reason?: unknown } })?.details?.reason;
  return typeof r === 'string' ? r : 'unknown';
}

/**
 * 事業所のメンバー（管理者・一般）
 * - 一覧・権限の変更・外す・代表の交代・招待を使う：関数（名簿を書き換えられるのは関数だけ）
 * - 招待を作る・一覧・取り消す：ルールで管理者だけ（offices/{o}/invites、kind: member）
 */
@Injectable({ providedIn: 'root' })
export class MemberService {
  private col(officeId: string) {
    return collection(db, 'offices', officeId, 'invites');
  }

  async list(officeId: string): Promise<MemberView[]> {
    const call = httpsCallable<{ officeId: string }, { members: MemberView[] }>(functions, 'siListMembers');
    return (await call({ officeId })).data.members;
  }

  async update(officeId: string, targetUid: string, action: MemberAction): Promise<void> {
    await httpsCallable(functions, 'siUpdateMember')({ officeId, targetUid, action });
  }

  /** 招待を使って参加する（メールの確認・アドレスの一致は関数が確かめる） */
  async accept(officeId: string, code: string, lang: string): Promise<void> {
    await httpsCallable(functions, 'siAcceptMemberInvite')({ officeId, code, lang });
  }

  /** 管理者：招待を作る（アドレスは必須。そのアドレスで、メールの確認を済ませた人だけが使える） */
  async createInvite(officeId: string, email: string, role: OfficeRole): Promise<Invite> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('not signed in');
    const code = makeInviteCode((n) => crypto.getRandomValues(new Uint8Array(n)));
    const data = {
      code,
      kind: 'member' as const,
      employeeId: null,
      role,
      email: email.trim().toLowerCase(),
      expiresAt: Timestamp.fromMillis(Date.now() + INVITE_DAYS * 86_400_000),
      usedBy: null,
      usedAt: null,
      createdBy: uid,
    };
    await setDoc(doc(this.col(officeId), code), { ...data, createdAt: serverTimestamp() });
    return { ...data, createdAt: Timestamp.now() };
  }

  /** 管理者：まだ使われていない、期限内のメンバーの招待（新しい順） */
  async pendingInvites(officeId: string): Promise<Invite[]> {
    const snap = await countedGetDocs(query(this.col(officeId), where('kind', '==', 'member')));
    const now = Date.now();
    return snap.docs
      .map((d) => d.data() as InviteDoc)
      .filter((i) => inviteState({ usedBy: i.usedBy, expiresMs: i.expiresAt.toMillis() }, now) === 'usable')
      .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  }

  async revoke(officeId: string, code: string): Promise<void> {
    await deleteDoc(doc(this.col(officeId), code));
  }
}
