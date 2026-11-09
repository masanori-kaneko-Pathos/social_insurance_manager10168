import { Injectable, inject } from '@angular/core';
import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../../core/firebase';
import { EmployeeDoc } from '../../core/models/employee';
import {
  EmployeeRequest,
  InboxNotification,
  NotificationDoc,
  RequestDoc,
  RequestQuestion,
  RequestType,
} from '../../core/models/office-records';
import { HistoryService } from '../employees/history.service';
import { changesOf } from '../employees/logic/history';
import { planApply } from './logic/request-model';

/** 1回の batch に入れる従業員の数（依頼と受信箱の2件ずつ。上限500件に余裕を持たせる） */
const PER_BATCH = 200;

export interface NewRequest {
  type: RequestType;
  title: string;
  questions: RequestQuestion[];
  dueDate: string | null;
}

/**
 * 依頼と申請（offices/{o}/requests）と受信箱（offices/{o}/notifications）
 * - 依頼を出す・承認する・差し戻すときは、受信箱へのお知らせを同じ batch で書く
 * - 承認で従業員の情報を書き換えるときは、変更履歴も同じ batch で書く
 */
@Injectable({ providedIn: 'root' })
export class RequestService {
  private readonly history = inject(HistoryService);

  private col(officeId: string) {
    return collection(db, 'offices', officeId, 'requests');
  }

  private inbox(officeId: string) {
    return collection(db, 'offices', officeId, 'notifications');
  }

  private uid(): string {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('not signed in');
    return uid;
  }

  // ===== 読む =====

  /** 管理者：事業所のすべて */
  async listAll(officeId: string): Promise<EmployeeRequest[]> {
    const snap = await getDocs(this.col(officeId));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as RequestDoc) }));
  }

  /** 1人分（管理者も、従業員本人も。ルールが通すのは employeeId で絞った検索だけ） */
  async listFor(officeId: string, employeeId: string): Promise<EmployeeRequest[]> {
    const snap = await getDocs(query(this.col(officeId), where('employeeId', '==', employeeId)));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as RequestDoc) }));
  }

  /** 管理者：確認待ち（提出済み）の数（To-do リストに出す。数えるだけなので読み取りは少ない） */
  async countSubmitted(officeId: string): Promise<number> {
    const snap = await getCountFromServer(query(this.col(officeId), where('status', '==', 'submitted')));
    return snap.data().count;
  }

  async get(officeId: string, id: string): Promise<EmployeeRequest | null> {
    const snap = await getDoc(doc(this.col(officeId), id));
    return snap.exists() ? { id: snap.id, ...(snap.data() as RequestDoc) } : null;
  }

  /** 受信箱（1人分・新しい順） */
  async inboxFor(officeId: string, employeeId: string): Promise<InboxNotification[]> {
    const snap = await getDocs(query(this.inbox(officeId), where('employeeId', '==', employeeId)));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as NotificationDoc) }))
      .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  }

  // ===== 管理者 =====

  /** 依頼を出す（1人でも、まとめてでも）。1人に1件の依頼と、受信箱のお知らせ */
  async sendToEmployees(officeId: string, employeeIds: string[], r: NewRequest): Promise<number> {
    const uid = this.uid();
    for (let i = 0; i < employeeIds.length; i += PER_BATCH) {
      const batch = writeBatch(db);
      for (const employeeId of employeeIds.slice(i, i + PER_BATCH)) {
        const ref = doc(this.col(officeId));
        batch.set(ref, {
          type: r.type,
          direction: 'toEmployee',
          employeeId,
          title: r.title,
          questions: r.questions,
          answers: {},
          status: 'open',
          comment: null,
          dueDate: r.dueDate,
          createdBy: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        this.notify(batch, officeId, employeeId, 'request', r.title, '', ref.id);
      }
      await batch.commit();
    }
    return employeeIds.length;
  }

  /**
   * 承認：答えを従業員の情報へ書き込み（変更履歴つき）、依頼を「承認済み」にして、本人に知らせる
   * 書き込む前に、従業員の今の値を読み直す（画面を開いたあとで変わっていても、正しい履歴になるように）
   */
  async approve(officeId: string, r: EmployeeRequest, comment: string | null, noticeTitle: string): Promise<void> {
    const empRef = doc(db, 'offices', officeId, 'employees', r.employeeId);
    const snap = await getDoc(empRef);
    if (!snap.exists()) throw new Error('employee not found');
    const before = snap.data() as EmployeeDoc;
    const { patch } = planApply(before, r.questions, r.answers);

    const batch = writeBatch(db);
    if (Object.keys(patch).length > 0) {
      batch.update(empRef, { ...patch, updatedAt: serverTimestamp() });
      const changes = changesOf(
        before as unknown as Record<string, unknown>,
        { ...before, ...patch } as unknown as Record<string, unknown>,
      );
      this.history.addTo(batch, officeId, r.employeeId, 'employee', changes);
    }
    batch.update(doc(this.col(officeId), r.id), {
      status: 'approved',
      comment: comment?.trim() ? comment.trim().slice(0, 500) : null,
      updatedAt: serverTimestamp(),
    });
    this.notify(batch, officeId, r.employeeId, 'notice', noticeTitle, comment ?? '', r.id);
    await batch.commit();
  }

  /** 削除（出し間違いなど。受信箱のお知らせは残る） */
  async remove(officeId: string, id: string): Promise<void> {
    await deleteDoc(doc(this.col(officeId), id));
  }

  /** 差し戻し：理由をつけて本人に返す（本人が直して出し直せる） */
  async reject(officeId: string, r: EmployeeRequest, comment: string, noticeTitle: string): Promise<void> {
    const batch = writeBatch(db);
    batch.update(doc(this.col(officeId), r.id), {
      status: 'rejected',
      comment: comment.trim().slice(0, 500),
      updatedAt: serverTimestamp(),
    });
    this.notify(batch, officeId, r.employeeId, 'notice', noticeTitle, comment, r.id);
    await batch.commit();
  }

  private notify(
    batch: ReturnType<typeof writeBatch>,
    officeId: string,
    employeeId: string,
    kind: 'request' | 'notice',
    title: string,
    body: string,
    requestId: string,
  ): void {
    batch.set(doc(this.inbox(officeId)), {
      employeeId,
      kind,
      title: title.slice(0, 100),
      body: body ? body.slice(0, 2000) : null,
      link: requestId,
      readAt: null,
      createdAt: serverTimestamp(),
    });
  }

  // ===== 従業員本人 =====

  /** 依頼に答えて出す（まだ・差し戻しのものだけ。ルールでも確かめる） */
  async submit(officeId: string, id: string, answers: Record<string, string>): Promise<void> {
    await updateDoc(doc(this.col(officeId), id), { answers, status: 'submitted', updatedAt: serverTimestamp() });
  }

  /** 変更の申請（自分から）：答えを入れて、提出済みで作る */
  async applyChange(
    officeId: string,
    employeeId: string,
    title: string,
    questions: RequestQuestion[],
    answers: Record<string, string>,
  ): Promise<string> {
    const ref = doc(this.col(officeId));
    const batch = writeBatch(db);
    batch.set(ref, {
      type: 'change',
      direction: 'fromEmployee',
      employeeId,
      title,
      questions,
      answers,
      status: 'submitted',
      comment: null,
      dueDate: null,
      createdBy: this.uid(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return ref.id;
  }

  /** 受信箱：既読にする */
  async markRead(officeId: string, notificationId: string): Promise<void> {
    await updateDoc(doc(this.inbox(officeId), notificationId), { readAt: serverTimestamp() });
  }
}
