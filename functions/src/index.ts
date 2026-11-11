// 社会保険管理システムの関数（codebase: shaho。課題管理アプリの関数（im…）とは分けてある）
// 事業所の名簿（memberUids・memberRoles・ownerUid）を書き換えるのは、ここだけ。ルールでは名簿を誰にも書き換えさせない
// 判断は member-rules.ts の純粋な関数（spec あり）。ここは「読む → 判断 → 書く」をトランザクションでつなぐだけ

import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  actionsFor,
  applyAction,
  deleteProblem,
  denyReason,
  MemberAction,
  MemberRole,
  memberInviteProblem,
  ownerOf,
  Roster,
} from './member-rules.js';

initializeApp();
const db = getFirestore('socialinsurance-db');
const REGION = 'asia-northeast1';

interface OfficeData {
  memberUids: string[];
  memberRoles: Record<string, MemberRole>;
  ownerUid?: string;
}

interface InviteData {
  kind: string;
  role: string | null;
  email: string | null;
  usedBy: string | null;
  expiresAt: Timestamp;
}

/** 画面が翻訳できるよう、理由のコードを details に入れて返す */
function fail(code: 'failed-precondition' | 'permission-denied' | 'invalid-argument' | 'not-found', reason: string): never {
  throw new HttpsError(code, reason, { reason });
}

function needUid(auth: { uid: string } | undefined): string {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'signIn', { reason: 'signIn' });
  return auth.uid;
}

function idArg(v: unknown, max = 128): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]+$/.test(v) || v.length > max) fail('invalid-argument', 'badArgument');
  return v;
}

function rosterOf(o: OfficeData): Roster {
  return { roles: o.memberRoles ?? {}, owner: ownerOf(o) };
}

/**
 * メンバーの招待を使って、事業所に参加する
 * - 招待：種類が member・未使用・期限内・アドレスが同じ・メールの確認が済んでいる
 * - users がなければ「一般」（事業所を作れないアカウント）で作る。従業員のアカウントは断る
 * - 名簿に足す・招待を使用済みにする・開く事業所をこの事業所にする、を1つのトランザクションで
 */
export const siAcceptMemberInvite = onCall({ region: REGION }, async (req) => {
  const uid = needUid(req.auth);
  const officeId = idArg(req.data?.officeId);
  const code = idArg(req.data?.code);
  const lang = req.data?.lang === 'en' ? 'en' : 'ja';
  const token = req.auth!.token;
  const authUser = await getAuth().getUser(uid);

  const officeRef = db.doc(`offices/${officeId}`);
  const inviteRef = db.doc(`offices/${officeId}/invites/${code}`);
  const userRef = db.doc(`users/${uid}`);

  await db.runTransaction(async (tx) => {
    const [o, i, u] = await tx.getAll(officeRef, inviteRef, userRef);
    if (!o.exists) fail('not-found', 'notFound');
    const office = o.data() as OfficeData;
    const inv = i.exists ? (i.data() as InviteData) : null;
    const problem = memberInviteProblem(
      inv && { kind: inv.kind, role: inv.role, email: inv.email, usedBy: inv.usedBy, expiresMs: inv.expiresAt.toMillis() },
      {
        email: token.email ?? null,
        emailVerified: token.email_verified === true,
        appRole: u.exists ? (u.data()?.role ?? null) : null,
        isMember: (office.memberUids ?? []).includes(uid),
      },
      Date.now(),
    );
    if (problem) fail('failed-precondition', problem);

    const now = FieldValue.serverTimestamp();
    if (u.exists) {
      tx.update(userRef, { currentOfficeId: officeId, updatedAt: now });
    } else {
      tx.set(userRef, {
        email: token.email,
        displayName: (authUser.displayName || token.email || '').slice(0, 50),
        role: 'general',
        currentOfficeId: officeId,
        lang,
        employeeRef: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    tx.update(officeRef, {
      memberUids: FieldValue.arrayUnion(uid),
      [`memberRoles.${uid}`]: inv!.role,
      // 古い事業所には代表の印がないので、ここで書いておく（名簿の最初の人）
      ...(office.ownerUid ? {} : { ownerUid: ownerOf(office) }),
      updatedAt: now,
    });
    tx.update(inviteRef, { usedBy: uid, usedAt: now });
  });
  return { ok: true };
});

/** 事業所のメンバーの一覧（名前・アドレス・権限・代表・この人に自分ができる操作）。メンバーなら誰でも */
export const siListMembers = onCall({ region: REGION }, async (req) => {
  const uid = needUid(req.auth);
  const officeId = idArg(req.data?.officeId);
  const o = await db.doc(`offices/${officeId}`).get();
  if (!o.exists) fail('not-found', 'notFound');
  const office = o.data() as OfficeData;
  const roster = rosterOf(office);
  if (!roster.roles[uid]) fail('permission-denied', 'notMember');

  const uids = office.memberUids ?? [];
  const users = uids.length ? await db.getAll(...uids.map((m) => db.doc(`users/${m}`))) : [];
  const members = uids.map((m, k) => {
    const d = users[k]?.data();
    return {
      uid: m,
      name: (d?.displayName as string | undefined) ?? '',
      email: (d?.email as string | undefined) ?? '',
      role: roster.roles[m] ?? 'general',
      owner: m === roster.owner,
      me: m === uid,
      actions: actionsFor(roster, uid, m),
    };
  });
  // 代表 → 管理者 → 一般、同じ中は名前の順
  const rank = (x: (typeof members)[number]) => (x.owner ? 0 : x.role === 'admin' ? 1 : 2);
  members.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ja'));
  return { members };
});

/** 権限の変更・外す・代表の交代（決まりは member-rules.ts） */
export const siUpdateMember = onCall({ region: REGION }, async (req) => {
  const uid = needUid(req.auth);
  const officeId = idArg(req.data?.officeId);
  const target = idArg(req.data?.targetUid);
  const action = req.data?.action as MemberAction;
  if (!['promote', 'demote', 'remove', 'transfer'].includes(action)) fail('invalid-argument', 'badArgument');

  const officeRef = db.doc(`offices/${officeId}`);
  const targetUserRef = db.doc(`users/${target}`);
  await db.runTransaction(async (tx) => {
    const [o, t] = await tx.getAll(officeRef, targetUserRef);
    if (!o.exists) fail('not-found', 'notFound');
    const office = o.data() as OfficeData;
    const roster = rosterOf(office);
    const reason = denyReason(roster, uid, target, action);
    if (reason) fail('permission-denied', reason);

    const after = applyAction(roster, target, action);
    const now = FieldValue.serverTimestamp();
    if (action === 'remove') {
      tx.update(officeRef, {
        memberUids: FieldValue.arrayRemove(target),
        [`memberRoles.${target}`]: FieldValue.delete(),
        ...(office.ownerUid ? {} : { ownerUid: after.owner }),
        updatedAt: now,
      });
      // 外された人が次に開くとき、この事業所を開こうとしないように
      if (t.exists && t.data()?.currentOfficeId === officeId) {
        tx.update(targetUserRef, { currentOfficeId: null, updatedAt: now });
      }
    } else {
      tx.update(officeRef, {
        [`memberRoles.${target}`]: after.roles[target],
        ownerUid: after.owner,
        updatedAt: now,
      });
    }
  });
  return { ok: true };
});

/**
 * 本人のアカウントを消す（管理者・一般だけ。代表になっている事業所があれば断る。決まりは deleteProblem）
 * 順番：名簿から外す・users を消す（トランザクション）→ 最後に Auth のアカウントを消す
 * （途中で失敗しても「名簿に残っているのにログインできない人」が出ないように、Auth を最後にする）
 * 本人の確認（パスワードの再入力）は画面で済ませてから呼ぶ。作った記録（変更履歴・招待など）は会社の記録なので残す
 */
export const siDeleteAccount = onCall({ region: REGION }, async (req) => {
  const uid = needUid(req.auth);
  const userRef = db.doc(`users/${uid}`);
  const officesQuery = db.collection('offices').where('memberUids', 'array-contains', uid);

  await db.runTransaction(async (tx) => {
    const [user, offices] = await Promise.all([tx.get(userRef), tx.get(officesQuery)]);
    const appRole = (user.data()?.role as string | undefined) ?? null;
    const problem = deleteProblem(
      uid,
      appRole,
      offices.docs.map((d) => d.data() as OfficeData),
    );
    if (problem) fail('failed-precondition', problem);

    const now = FieldValue.serverTimestamp();
    for (const o of offices.docs) {
      tx.update(o.ref, {
        memberUids: FieldValue.arrayRemove(uid),
        [`memberRoles.${uid}`]: FieldValue.delete(),
        updatedAt: now,
      });
    }
    if (user.exists) tx.delete(userRef);
  });

  await getAuth().deleteUser(uid);
  return { ok: true };
});
