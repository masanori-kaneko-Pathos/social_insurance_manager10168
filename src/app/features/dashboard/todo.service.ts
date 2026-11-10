import { inject, Injectable } from '@angular/core';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../../core/firebase';
import { TodoDismissalDoc } from '../../core/models/office-records';
import { HistoryService } from '../employees/history.service';
import { changesOf } from '../employees/logic/history';
import { ActionSave } from './logic/todo-actions';

/**
 * To-do をその場で片づけたときの書き込み
 * - 届書の窓：従業員の加入・標準報酬（資格取得時決定）・変更履歴・届出の記録・確認済み を1つの batch で書く
 *   （途中で失敗して「加入にはなったが記録がない」を起こさない）
 * - 「確認した」：todoDismissals に1件（取り消しは消すだけ）
 */
@Injectable({ providedIn: 'root' })
export class TodoService {
  private readonly history = inject(HistoryService);

  private uid(): string {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('not signed in');
    return uid;
  }

  private dismissals(officeId: string) {
    return collection(db, 'offices', officeId, 'todoDismissals');
  }

  // ===== 確認済み =====

  async listDismissals(officeId: string): Promise<TodoDismissalDoc[]> {
    const snap = await getDocs(this.dismissals(officeId));
    return snap.docs.map((d) => d.data() as TodoDismissalDoc);
  }

  async dismiss(officeId: string, key: string): Promise<void> {
    await setDoc(doc(this.dismissals(officeId), key), {
      key,
      until: null,
      dismissedBy: this.uid(),
      createdAt: serverTimestamp(),
    });
  }

  async undismiss(officeId: string, key: string): Promise<void> {
    await deleteDoc(doc(this.dismissals(officeId), key));
  }

  // ===== 届書の窓 =====

  async save(officeId: string, employeeId: string, s: ActionSave, dismissKey: string | null): Promise<void> {
    const uid = this.uid();
    const batch = writeBatch(db);
    const empRef = doc(db, 'offices', officeId, 'employees', employeeId);

    // 加入（変わる前を読んで、変更履歴を同じ batch に）
    if (s.enrollment) {
      const snap = await getDoc(empRef);
      const before = snap.data() as Record<string, unknown> | undefined;
      if (!before) throw new Error('employee not found');
      batch.update(empRef, { ...s.enrollment, updatedAt: serverTimestamp() });
      this.history.addTo(batch, officeId, employeeId, 'employee', changesOf(before, { ...before, ...s.enrollment }));
    }

    // 資格取得時決定の標準報酬（その月がまだないときだけ。buildSave で決めてある）
    if (s.remuneration) {
      const r = s.remuneration;
      const ref = doc(db, 'offices', officeId, 'employees', employeeId, 'remunerations', r.from);
      batch.set(ref, { ...r, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      this.history.addTo(batch, officeId, employeeId, `remunerations/${r.from}`, changesOf(null, { ...r }));
    }

    // 届出の記録（後で作る届出の CSV の材料にもなる）
    batch.set(doc(collection(db, 'offices', officeId, 'filings')), {
      type: s.filing.type,
      employeeIds: [employeeId],
      subject: s.filing.subject,
      submittedOn: s.filing.submittedOn,
      note: null,
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // 年齢到達・区分変更届は、To-do から消すために確認済みも残す
    if (dismissKey) {
      batch.set(doc(this.dismissals(officeId), dismissKey), {
        key: dismissKey,
        until: null,
        dismissedBy: uid,
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }
}
