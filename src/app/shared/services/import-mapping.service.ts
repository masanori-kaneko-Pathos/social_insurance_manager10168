import { Injectable } from '@angular/core';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../../core/firebase';
import { countedGetDoc } from '../../core/read-meter';
import { SavedMapping } from '../import/column-map';

/**
 * 取り込みの「列を合わせる」の割り当てを、事業所ごと・取り込みの種類ごとに覚える（11/24）
 * offices/{officeId}/importMappings/{key}（key：payrolls・bonuses・employees など）
 * 読むのはメンバー、書くのは管理者（ルール）。覚えられなくても取り込みは続けられるので、失敗は画面に出さない
 */
@Injectable({ providedIn: 'root' })
export class ImportMappingService {
  private ref(officeId: string, key: string) {
    return doc(db, 'offices', officeId, 'importMappings', key);
  }

  async get(officeId: string, key: string): Promise<SavedMapping | null> {
    const snap = await countedGetDoc(this.ref(officeId, key));
    if (!snap.exists()) return null;
    return ((snap.data() as { fields?: SavedMapping }).fields ?? null);
  }

  async save(officeId: string, key: string, fields: SavedMapping): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await setDoc(this.ref(officeId, key), { key, fields, updatedBy: uid, updatedAt: serverTimestamp() });
  }
}
