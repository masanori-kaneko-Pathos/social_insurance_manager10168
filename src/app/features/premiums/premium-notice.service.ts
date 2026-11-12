import { Injectable } from '@angular/core';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { countedGetDoc, countedGetDocs } from '../../core/read-meter';
import { auth, db } from '../../core/firebase';
import { PremiumNotice, PremiumNoticeDoc } from '../../core/models/premium-notice';

/** 毎月の納付額の突き合わせ（告知額と、確かめた理由） */
@Injectable({ providedIn: 'root' })
export class PremiumNoticeService {
  private ref(officeId: string, month: string) {
    return doc(db, 'offices', officeId, 'premiumNotices', month);
  }

  /** その月の記録（なければ null） */
  async get(officeId: string, month: string): Promise<PremiumNotice | null> {
    const snap = await countedGetDoc(this.ref(officeId, month));
    if (!snap.exists()) return null;
    const { createdAt: _c, updatedAt: _u, ...rest } = snap.data() as PremiumNoticeDoc;
    return rest;
  }

  /** 書く（作るか上書き。作った日時は残す） */
  async save(
    officeId: string,
    input: Omit<PremiumNotice, 'updatedBy'>,
    exists: boolean,
  ): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('not signed in');
    const data = { ...input, updatedBy: uid, updatedAt: serverTimestamp() };
    await setDoc(this.ref(officeId, input.month), exists ? data : { ...data, createdAt: serverTimestamp() }, {
      merge: exists,
    });
  }
}
