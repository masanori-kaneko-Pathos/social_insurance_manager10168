import { Injectable } from '@angular/core';
import { addDoc, collection, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { countedGetDoc, countedGetDocs } from '../../core/read-meter';
import { auth, db } from '../../core/firebase';
import { Recalc, RecalcDoc } from '../../core/models/employee-records';

/** 遡及計算の結果（offices/{o}/employees/{e}/recalcs/{自動ID}）。元のデータは書き換えない。結果は直さず、要らなければ消す */
@Injectable({ providedIn: 'root' })
export class RecalcService {
  private col(officeId: string, employeeId: string) {
    return collection(db, 'offices', officeId, 'employees', employeeId, 'recalcs');
  }

  /** 新しい順 */
  async list(officeId: string, employeeId: string): Promise<Recalc[]> {
    const snap = await countedGetDocs(this.col(officeId, employeeId));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as RecalcDoc) }))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  }

  async create(
    officeId: string,
    employeeId: string,
    input: Omit<RecalcDoc, 'createdBy' | 'createdAt'>,
  ): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('not signed in');
    await addDoc(this.col(officeId, employeeId), { ...input, createdBy: uid, createdAt: serverTimestamp() });
  }

  async delete(officeId: string, employeeId: string, id: string): Promise<void> {
    await deleteDoc(doc(this.col(officeId, employeeId), id));
  }
}
