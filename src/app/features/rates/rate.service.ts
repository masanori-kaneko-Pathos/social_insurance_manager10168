import { Injectable } from '@angular/core';
import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { countedGetDoc, countedGetDocs } from '../../core/read-meter';
import { db } from '../../core/firebase';
import {
  GradeTableDoc,
  KumiaiRateDoc,
  KumiaiRateInput,
  MasterRateDoc,
} from '../../core/models/rates';
import { RateTables } from './logic/pick-rates';

@Injectable({ providedIn: 'root' })
export class RateService {
  /** 料率マスタは全事業所共通で、めったに変わらないので、1回読んだら使い回す */
  private masterCache: Promise<MasterRateDoc[]> | null = null;

  /** 料率マスタ（協会けんぽ・全国一律） */
  master(): Promise<MasterRateDoc[]> {
    if (!this.masterCache) {
      this.masterCache = countedGetDocs(collection(db, 'masterRates'))
        .then((snap) => snap.docs.map((d) => d.data() as MasterRateDoc))
        .catch((err) => {
          this.masterCache = null; // 失敗したら次回は読み直す
          throw err;
        });
    }
    return this.masterCache;
  }

  private gradesCache: Promise<GradeTableDoc[]> | null = null;

  /** 標準報酬月額の等級表（健保・厚年。全事業所共通なので使い回す） */
  grades(): Promise<GradeTableDoc[]> {
    if (!this.gradesCache) {
      this.gradesCache = countedGetDocs(collection(db, 'masterGrades'))
        .then((snap) => snap.docs.map((d) => d.data() as GradeTableDoc))
        .catch((err) => {
          this.gradesCache = null;
          throw err;
        });
    }
    return this.gradesCache;
  }

  private kumiaiCol(officeId: string) {
    return collection(db, 'offices', officeId, 'kumiaiRates');
  }

  /** 組合健保の料率（新しい順） */
  async kumiaiList(officeId: string): Promise<KumiaiRateDoc[]> {
    const snap = await countedGetDocs(this.kumiaiCol(officeId));
    return snap.docs
      .map((d) => d.data() as KumiaiRateDoc)
      .sort((a, b) => b.from.localeCompare(a.from));
  }

  /** 保険料の計算に使う料率の一式（組合健保だった時期がなければ、組合の料率は読まない） */
  async tablesFor(officeId: string, needKumiai: boolean): Promise<RateTables> {
    const [master, kumiai] = await Promise.all([
      this.master(),
      needKumiai ? this.kumiaiList(officeId) : Promise.resolve([]),
    ]);
    return { master, kumiai };
  }

  /** 組合健保の料率を登録（ドキュメントIDは適用開始月） */
  async createKumiai(officeId: string, input: KumiaiRateInput): Promise<void> {
    await setDoc(doc(this.kumiaiCol(officeId), input.from), {
      ...input,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  async updateKumiai(officeId: string, input: KumiaiRateInput): Promise<void> {
    await updateDoc(doc(this.kumiaiCol(officeId), input.from), {
      ...input,
      updatedAt: serverTimestamp(),
    });
  }

  async deleteKumiai(officeId: string, from: string): Promise<void> {
    await deleteDoc(doc(this.kumiaiCol(officeId), from));
  }
}
