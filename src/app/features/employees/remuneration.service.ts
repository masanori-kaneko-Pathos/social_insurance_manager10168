import { Injectable } from '@angular/core';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../core/firebase';
import { RemunerationDoc, RemunerationInput } from '../../core/models/remuneration';

/** 従業員ごとの標準報酬月額の履歴（ドキュメントIDは適用開始月） */
@Injectable({ providedIn: 'root' })
export class RemunerationService {
  private col(officeId: string, employeeId: string) {
    return collection(db, 'offices', officeId, 'employees', employeeId, 'remunerations');
  }

  /** 新しい順 */
  async list(officeId: string, employeeId: string): Promise<RemunerationDoc[]> {
    const snap = await getDocs(this.col(officeId, employeeId));
    return snap.docs
      .map((d) => d.data() as RemunerationDoc)
      .sort((a, b) => b.from.localeCompare(a.from));
  }

  async create(officeId: string, employeeId: string, input: RemunerationInput): Promise<void> {
    await setDoc(doc(this.col(officeId, employeeId), input.from), {
      ...input,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  async update(officeId: string, employeeId: string, input: RemunerationInput): Promise<void> {
    await updateDoc(doc(this.col(officeId, employeeId), input.from), {
      ...input,
      updatedAt: serverTimestamp(),
    });
  }

  async delete(officeId: string, employeeId: string, from: string): Promise<void> {
    await deleteDoc(doc(this.col(officeId, employeeId), from));
  }
}