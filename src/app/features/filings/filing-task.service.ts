import { Injectable } from '@angular/core';
import {
  collection,
  doc,
  query,
  serverTimestamp,
  updateDoc,
  where,
  WriteBatch,
} from 'firebase/firestore';
import { countedGetDoc, countedGetDocs } from '../../core/read-meter';
import { db } from '../../core/firebase';
import { FilingTask, FilingTaskDoc, FilingTaskInput } from '../../core/models/filing-task';

/** 届出の宿題（core/models/filing-task.ts）。読み書きは管理者だけ */
@Injectable({ providedIn: 'root' })
export class FilingTaskService {
  private ref(officeId: string) {
    return collection(db, 'offices', officeId, 'filingTasks');
  }

  /** まだの宿題（To-do に出す）。事業所ごとに1回の問い合わせ */
  async listOpen(officeId: string): Promise<FilingTask[]> {
    const snap = await countedGetDocs(query(this.ref(officeId), where('status', '==', 'open')));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as FilingTaskDoc) }));
  }

  /** 宿題を batch に足す（変更の保存と同じ batch にして、片方だけ残らないようにする） */
  addTo(batch: WriteBatch, officeId: string, input: FilingTaskInput): void {
    batch.set(doc(this.ref(officeId)), {
      ...input,
      status: 'open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      doneAt: null,
    });
  }

  /** 「届を出した」「確認した」 */
  async markDone(officeId: string, id: string): Promise<void> {
    await updateDoc(doc(this.ref(officeId), id), {
      status: 'done',
      doneAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}
