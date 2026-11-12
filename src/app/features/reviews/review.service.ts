import { Injectable, inject } from '@angular/core';
import { deleteDoc, doc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { countedGetDoc, countedGetDocs } from '../../core/read-meter';
import { auth, db } from '../../core/firebase';
import { UserProfileService } from '../../core/auth/user-profile.service';

/** offices/{o}/reviews/{対象の鍵}（届書の一覧・納付の突き合わせのダブルチェック） */
export interface Review {
  target: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: Timestamp | null;
  checkedBy: string | null;
  checkedByName: string | null;
  checkedAt: Timestamp | null;
  comment: string | null;
}

@Injectable({ providedIn: 'root' })
export class ReviewService {
  private readonly profiles = inject(UserProfileService);

  private ref(officeId: string, id: string) {
    return doc(db, 'offices', officeId, 'reviews', id);
  }

  private me(): { uid: string; name: string } {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('not signed in');
    const p = this.profiles.profile();
    return { uid, name: (p?.displayName || auth.currentUser?.email || '—').slice(0, 50) };
  }

  async get(officeId: string, id: string): Promise<Review | null> {
    const snap = await countedGetDoc(this.ref(officeId, id));
    return snap.exists() ? (snap.data() as Review) : null;
  }

  /** 管理者：確認を頼む */
  async request(officeId: string, id: string): Promise<void> {
    const me = this.me();
    await setDoc(this.ref(officeId, id), {
      target: id,
      requestedBy: me.uid,
      requestedByName: me.name,
      requestedAt: serverTimestamp(),
      checkedBy: null,
      checkedByName: null,
      checkedAt: null,
      comment: null,
      updatedAt: serverTimestamp(),
    });
  }

  /** 頼んだ人とは別の人：確認した（ひとことを添えられる） */
  async check(officeId: string, id: string, comment: string | null): Promise<void> {
    const me = this.me();
    await updateDoc(this.ref(officeId, id), {
      checkedBy: me.uid,
      checkedByName: me.name,
      checkedAt: serverTimestamp(),
      comment,
      updatedAt: serverTimestamp(),
    });
  }

  /** 管理者：やり直す（直したあとに頼み直すため、記録を消す） */
  async reset(officeId: string, id: string): Promise<void> {
    await deleteDoc(this.ref(officeId, id));
  }
}
