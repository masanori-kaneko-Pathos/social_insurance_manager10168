import { Injectable } from '@angular/core';
import { collection } from 'firebase/firestore';
import { countedGetDoc, countedGetDocs } from '../../core/read-meter';
import { db } from '../../core/firebase';
import { CriteriaDoc } from '../../core/models/master';

/** 加入の基準（masterCriteria）。全事業所共通で、めったに変わらないので、1回読んだら使い回す */
@Injectable({ providedIn: 'root' })
export class CriteriaService {
  private cache: Promise<CriteriaDoc[]> | null = null;

  list(): Promise<CriteriaDoc[]> {
    if (!this.cache) {
      this.cache = countedGetDocs(collection(db, 'masterCriteria'))
        .then((snap) => snap.docs.map((d) => d.data() as CriteriaDoc))
        .catch((err) => {
          this.cache = null; // 失敗したら次回は読み直す
          throw err;
        });
    }
    return this.cache;
  }
}
