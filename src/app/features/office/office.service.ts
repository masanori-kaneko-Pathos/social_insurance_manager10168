import { Injectable } from '@angular/core';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../core/firebase';
import {
  Office,
  OfficeBasicInput,
  OfficeDoc,
  OfficeInput,
  officeExtras,
} from '../../core/models/office';

@Injectable({ providedIn: 'root' })
export class OfficeService {
  /** 事業所を作成し、自分の currentOfficeId をその事業所にする（同時に） */
  async create(uid: string, input: OfficeBasicInput): Promise<string> {
    const officeRef = doc(collection(db, 'offices'));
    const batch = writeBatch(db);
    const full: OfficeInput = { ...officeExtras(), ...input };

    batch.set(officeRef, {
      ...full,
      memberUids: [uid],
      memberRoles: { [uid]: 'admin' },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'users', uid), {
      currentOfficeId: officeRef.id,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    return officeRef.id;
  }

  /** 事業所を更新する（メンバーと作成日時は変えない。ルールでも禁止している） */
  async update(officeId: string, input: OfficeBasicInput | Partial<OfficeInput>): Promise<void> {
    await updateDoc(doc(db, 'offices', officeId), {
      ...input,
      updatedAt: serverTimestamp(),
    });
  }

  /** 自分が所属している事業所の一覧 */
  async listMine(uid: string): Promise<Office[]> {
    const q = query(collection(db, 'offices'), where('memberUids', 'array-contains', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as OfficeDoc) }));
  }

  /** 1件読む（メンバーでなければルールで拒否される） */
  async get(officeId: string): Promise<Office | null> {
    const snap = await getDoc(doc(db, 'offices', officeId));
    return snap.exists() ? { id: snap.id, ...(snap.data() as OfficeDoc) } : null;
  }

  /** 読めなければ null（存在しない・メンバーでない） */
  async tryGet(officeId: string): Promise<Office | null> {
    try {
      return await this.get(officeId);
    } catch (err) {
      if ((err as { code?: string }).code === 'permission-denied') return null;
      throw err;
    }
  }
}
