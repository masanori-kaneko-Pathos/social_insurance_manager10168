import { Injectable } from '@angular/core';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../core/firebase';
import { Dependent, DependentDoc, DependentInput } from '../../core/models/dependent';

/** 従業員ごとの扶養家族（ドキュメントIDは自動） */
@Injectable({ providedIn: 'root' })
export class DependentService {
  private col(officeId: string, employeeId: string) {
    return collection(db, 'offices', officeId, 'employees', employeeId, 'dependents');
  }

  async list(officeId: string, employeeId: string): Promise<Dependent[]> {
    const snap = await getDocs(this.col(officeId, employeeId));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as DependentDoc) }));
  }

  async create(officeId: string, employeeId: string, input: DependentInput): Promise<string> {
    const ref = await addDoc(this.col(officeId, employeeId), {
      ...input,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  }

  async update(officeId: string, employeeId: string, id: string, input: DependentInput): Promise<void> {
    await updateDoc(doc(this.col(officeId, employeeId), id), {
      ...input,
      updatedAt: serverTimestamp(),
    });
  }

  async delete(officeId: string, employeeId: string, id: string): Promise<void> {
    await deleteDoc(doc(this.col(officeId, employeeId), id));
  }
}
