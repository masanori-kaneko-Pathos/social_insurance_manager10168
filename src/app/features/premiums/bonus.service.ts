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
import { BonusPaymentDoc, BonusPayment, BonusPaymentInput } from '../../core/models/bonus';

/** 賞与の支給（事業所の下。1回の支給＝1件。ドキュメントIDは自動） */
@Injectable({ providedIn: 'root' })
export class BonusService {
  private col(officeId: string) {
    return collection(db, 'offices', officeId, 'bonusPayments');
  }

  /** 新しい順（年度の累計を出すため、いつも全件を読む。1事業所で年に数件なので軽い） */
  async list(officeId: string): Promise<BonusPayment[]> {
    const snap = await getDocs(this.col(officeId));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as BonusPaymentDoc) }))
      .sort((a, b) => b.paidDate.localeCompare(a.paidDate));
  }

  /** 作ったドキュメントの ID を返す */
  async create(officeId: string, input: BonusPaymentInput): Promise<string> {
    const ref = doc(this.col(officeId)); // 先に ID だけ作る
    await setDoc(ref, {
      inKindAmounts: {},
      ...input,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  }

  /** amounts は丸ごと置き換わる（消した人は残らない） */
  async update(officeId: string, id: string, input: BonusPaymentInput): Promise<void> {
    await updateDoc(doc(this.col(officeId), id), { ...input, updatedAt: serverTimestamp() });
  }

  async delete(officeId: string, id: string): Promise<void> {
    await deleteDoc(doc(this.col(officeId), id));
  }
}
