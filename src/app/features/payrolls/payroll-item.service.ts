import { Injectable } from '@angular/core';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { countedGetDoc, countedGetDocs } from '../../core/read-meter';
import { db } from '../../core/firebase';
import { PayrollItem, PayrollItemDoc, PayrollItemInput, PayrollTemplateDoc } from '../../core/models/payroll-item';

/** 給与の項目（core/models/payroll-item.ts）。読むのはメンバー、書くのは管理者。11/24 */
@Injectable({ providedIn: 'root' })
export class PayrollItemService {
  /** 事業所ごとに覚えておく（内訳を開くたびに読まないように。書いたら忘れる） */
  private readonly cache = new Map<string, Promise<PayrollItem[]>>();

  private col(officeId: string) {
    return collection(db, 'offices', officeId, 'payrollItems');
  }

  list(officeId: string): Promise<PayrollItem[]> {
    let p = this.cache.get(officeId);
    if (!p) {
      p = countedGetDocs(this.col(officeId))
        .then((snap) =>
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as PayrollItemDoc) }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ja')),
        )
        .catch((err) => {
          this.cache.delete(officeId);
          throw err;
        });
      this.cache.set(officeId, p);
    }
    return p;
  }

  async create(officeId: string, input: PayrollItemInput): Promise<string> {
    this.cache.delete(officeId);
    const ref = await addDoc(this.col(officeId), { ...input, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  }

  async update(officeId: string, id: string, input: PayrollItemInput): Promise<void> {
    this.cache.delete(officeId);
    await updateDoc(doc(this.col(officeId), id), { ...input, updatedAt: serverTimestamp() });
  }

  // ===== 内訳のひな形（offices/{id}/payrollTemplates/default。11/24） =====

  private readonly templateCache = new Map<string, Promise<string[] | null>>();

  private templateRef(officeId: string) {
    return doc(db, 'offices', officeId, 'payrollTemplates', 'default');
  }

  /** 事業所のひな形（まだなければ null：アプリの例を使う） */
  template(officeId: string): Promise<string[] | null> {
    let p = this.templateCache.get(officeId);
    if (!p) {
      p = countedGetDoc(this.templateRef(officeId))
        .then((snap) => (snap.exists() ? (snap.data() as PayrollTemplateDoc).names : null))
        .catch((err) => {
          this.templateCache.delete(officeId);
          throw err;
        });
      this.templateCache.set(officeId, p);
    }
    return p;
  }

  async saveTemplate(officeId: string, names: readonly string[]): Promise<void> {
    this.templateCache.delete(officeId);
    await setDoc(this.templateRef(officeId), { names: [...names], updatedAt: serverTimestamp() });
  }

  /** 消しても、保存済みの給与の行は分類を写して持っているので計算は変わらない */
  async remove(officeId: string, id: string): Promise<void> {
    this.cache.delete(officeId);
    await deleteDoc(doc(this.col(officeId), id));
  }
}
