import { Injectable } from '@angular/core';
import {
  collection,
  doc,
  DocumentReference,
  limit,
  orderBy,
  query,
  serverTimestamp,
  WriteBatch,
  writeBatch,
} from 'firebase/firestore';
import { forgetForWrite } from '../../core/data-cache';
import { countedGetDoc, countedGetDocs } from '../../core/read-meter';
import { auth, db } from '../../core/firebase';
import { ChangeHistory, HistoryDoc } from '../../core/models/employee-records';
import { changesOf, FieldChange } from './logic/history';

export type WriteOp = 'set' | 'update' | 'delete';

/** 1回の書き込み（batch）の上限は500件。変更そのものの1件を残して、履歴はここまで */
const MAX_HISTORY_IN_BATCH = 450;

/**
 * 変更履歴（offices/{o}/employees/{e}/history/{自動ID}。足すだけ。直さない・消さない）
 * 変更と履歴は同じ batch に入れる → 「変更はされたのに履歴がない」は起きない
 */
@Injectable({ providedIn: 'root' })
export class HistoryService {
  private col(officeId: string, employeeId: string) {
    return collection(db, 'offices', officeId, 'employees', employeeId, 'history');
  }

  private uid(): string {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('not signed in');
    return uid;
  }

  /** 履歴を batch に足す（呼ぶ側がまとめて commit する） */
  addTo(
    batch: WriteBatch,
    officeId: string,
    employeeId: string,
    target: string,
    changes: readonly FieldChange[],
  ): void {
    const uid = this.uid();
    // 覚えておいた一覧を忘れる（書き込みはすべてここを通る。commit のあとに読み直させる）
    forgetForWrite(officeId, employeeId, target);
    for (const c of changes) {
      batch.set(doc(this.col(officeId, employeeId)), {
        target,
        field: c.field,
        before: c.before,
        after: c.after,
        changedBy: uid,
        changedAt: serverTimestamp(),
      });
    }
  }

  /**
   * 従業員の文書か、その下の1件を書き、変わった項目ごとの履歴を同じ batch で書く
   * - set：作る（同じ ID があれば置き換える）。update：渡した項目だけ書き換える。delete：消す
   * 変更前を知るために、書く前に1回読む
   */
  async write(
    officeId: string,
    employeeId: string,
    target: string,
    ref: DocumentReference,
    op: WriteOp,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    const snap = await countedGetDoc(ref);
    const before = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
    const after =
      op === 'delete' ? null : op === 'update' ? { ...(before ?? {}), ...data } : { ...data };
    const changes = changesOf(before, after).slice(0, MAX_HISTORY_IN_BATCH);
    const batch = writeBatch(db);
    if (op === 'set')
      batch.set(ref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    else if (op === 'update') batch.update(ref, { ...data, updatedAt: serverTimestamp() });
    else batch.delete(ref);
    this.addTo(batch, officeId, employeeId, target, changes);
    await batch.commit();
    // 書いている間に読まれて覚えられた古い値も、ここで忘れる
    forgetForWrite(officeId, employeeId, target);
  }

  /** 新しい順（多すぎる人は max 件まで） */
  async list(officeId: string, employeeId: string, max = 200): Promise<ChangeHistory[]> {
    const snap = await countedGetDocs(
      query(this.col(officeId, employeeId), orderBy('changedAt', 'desc'), limit(max)),
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as HistoryDoc) }));
  }
}
