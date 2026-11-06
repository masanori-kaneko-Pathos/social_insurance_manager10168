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
import { ContractDoc, ContractInput } from '../../core/models/contract';

/** 従業員ごとの雇用契約の履歴（ドキュメントIDは契約が始まる日） */
@Injectable({ providedIn: 'root' })
export class ContractService {
  private col(officeId: string, employeeId: string) {
    return collection(db, 'offices', officeId, 'employees', employeeId, 'contracts');
  }

  /** 新しい順 */
  async list(officeId: string, employeeId: string): Promise<ContractDoc[]> {
    const snap = await getDocs(this.col(officeId, employeeId));
    return snap.docs
      .map((d) => d.data() as ContractDoc)
      .sort((a, b) => b.from.localeCompare(a.from));
  }

  async create(officeId: string, employeeId: string, input: ContractInput): Promise<void> {
    await setDoc(doc(this.col(officeId, employeeId), input.from), {
      ...input,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  async update(officeId: string, employeeId: string, input: ContractInput): Promise<void> {
    await updateDoc(doc(this.col(officeId, employeeId), input.from), {
      ...input,
      updatedAt: serverTimestamp(),
    });
  }

  async delete(officeId: string, employeeId: string, from: string): Promise<void> {
    await deleteDoc(doc(this.col(officeId, employeeId), from));
  }
}