import { Injectable } from '@angular/core';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { countedGetDocs } from '../../core/read-meter';
import { db } from '../../core/firebase';
import { BonusItem, BonusItemDoc, BonusItemInput } from '../../core/models/bonus-item';

/** 賞与の項目（core/models/bonus-item.ts）。読むのはメンバー、書くのは管理者。11/19 */
@Injectable({ providedIn: 'root' })
export class BonusItemService {
  /** 事業所ごとに覚えておく（賞与・届書・定時決定のたびに読まないように。書いたら忘れる） */
  private readonly cache = new Map<string, Promise<BonusItem[]>>();

  private col(officeId: string) {
    return collection(db, 'offices', officeId, 'bonusItems');
  }

  list(officeId: string): Promise<BonusItem[]> {
    let p = this.cache.get(officeId);
    if (!p) {
      p = countedGetDocs(this.col(officeId))
        .then((snap) =>
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as BonusItemDoc) }))
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

  async create(officeId: string, input: BonusItemInput): Promise<string> {
    this.cache.delete(officeId);
    const ref = await addDoc(this.col(officeId), { ...input, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  }

  async update(officeId: string, id: string, input: BonusItemInput): Promise<void> {
    this.cache.delete(officeId);
    await updateDoc(doc(this.col(officeId), id), { ...input, updatedAt: serverTimestamp() });
  }
}
