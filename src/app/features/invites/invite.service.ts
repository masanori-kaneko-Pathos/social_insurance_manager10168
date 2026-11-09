import { Injectable, inject } from '@angular/core';
import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../../core/firebase';
import { Lang } from '../../core/i18n/language.service';
import { Invite, InviteDoc } from '../../core/models/office-records';
import { OfficeService } from '../office/office.service';
import { emailMatches, INVITE_DAYS, inviteState, makeInviteCode } from './logic/invite';

/** 招待を使えなかった理由（画面で翻訳する） */
export type InviteError = 'notFound' | 'used' | 'expired' | 'email' | 'kind';

export class InviteRejected extends Error {
  constructor(readonly reason: InviteError) {
    super(`invite: ${reason}`);
  }
}

/**
 * 従業員の招待（offices/{o}/invites/{コード}）
 * Cloud Functions を使わず、ルールが「招待・users・従業員」の3つを同じ batch で照らし合わせる
 */
@Injectable({ providedIn: 'root' })
export class InviteService {
  private readonly offices = inject(OfficeService);

  private col(officeId: string) {
    return collection(db, 'offices', officeId, 'invites');
  }

  /** 管理者：招待を作る（メールアドレスを決めると、そのアドレスでしか使えない） */
  async create(officeId: string, employeeId: string, email: string | null): Promise<Invite> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('not signed in');
    const code = makeInviteCode((n) => crypto.getRandomValues(new Uint8Array(n)));
    const data = {
      code,
      kind: 'employee' as const,
      employeeId,
      role: null,
      email: email ? email.trim().toLowerCase() : null,
      expiresAt: Timestamp.fromMillis(Date.now() + INVITE_DAYS * 86_400_000),
      usedBy: null,
      usedAt: null,
      createdBy: uid,
    };
    // マイページで使う「従業員向けの写し」を、今の設定で作っておく（古い事業所には、まだないことがある）
    await this.offices.publishForEmployees(officeId);
    await setDoc(doc(this.col(officeId), code), { ...data, createdAt: serverTimestamp() });
    return { ...data, createdAt: Timestamp.now() };
  }

  /** 管理者：その従業員への招待（新しい順） */
  async listFor(officeId: string, employeeId: string): Promise<Invite[]> {
    const snap = await getDocs(
      query(this.col(officeId), where('kind', '==', 'employee'), where('employeeId', '==', employeeId)),
    );
    return snap.docs
      .map((d) => d.data() as InviteDoc)
      .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  }

  /** 管理者：取り消す（使われる前のものだけ画面に出す） */
  async revoke(officeId: string, code: string): Promise<void> {
    await deleteDoc(doc(this.col(officeId), code));
  }

  /** コードで1件読む（なければ null） */
  async get(officeId: string, code: string): Promise<Invite | null> {
    const snap = await getDoc(doc(this.col(officeId), code));
    return snap.exists() ? (snap.data() as InviteDoc) : null;
  }

  /**
   * 招待を使う：users（役割 employee）・招待の使用・従業員の userUid を1つの batch で書く
   * 使えない招待なら InviteRejected を投げる（呼ぶ側で Auth のアカウントを消す）
   */
  async accept(officeId: string, code: string, user: User, displayName: string, lang: Lang): Promise<void> {
    const invite = await this.get(officeId, code);
    if (!invite) throw new InviteRejected('notFound');
    if (invite.kind !== 'employee' || !invite.employeeId) throw new InviteRejected('kind');
    const state = inviteState({ usedBy: invite.usedBy, expiresMs: invite.expiresAt.toMillis() }, Date.now());
    if (state !== 'usable') throw new InviteRejected(state);
    if (!emailMatches(invite.email, user.email ?? '')) throw new InviteRejected('email');

    const batch = writeBatch(db);
    batch.set(doc(db, 'users', user.uid), {
      email: user.email,
      displayName,
      role: 'employee',
      currentOfficeId: null,
      lang,
      employeeRef: { officeId, employeeId: invite.employeeId, inviteCode: code },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(this.col(officeId), code), { usedBy: user.uid, usedAt: serverTimestamp() });
    batch.update(doc(db, 'offices', officeId, 'employees', invite.employeeId), {
      userUid: user.uid,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  }
}
