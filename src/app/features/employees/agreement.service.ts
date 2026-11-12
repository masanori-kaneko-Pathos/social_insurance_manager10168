import { Injectable } from '@angular/core';
import { collection } from 'firebase/firestore';
import { countedGetDoc, countedGetDocs } from '../../core/read-meter';
import { db } from '../../core/firebase';
import { AgreementDoc } from '../../core/models/master';

/** 社会保障協定（masterAgreements）。全事業所共通で、めったに変わらないので、1回読んだら使い回す */
@Injectable({ providedIn: 'root' })
export class AgreementService {
  private cache: Promise<AgreementDoc[]> | null = null;

  list(): Promise<AgreementDoc[]> {
    if (!this.cache) {
      this.cache = countedGetDocs(collection(db, 'masterAgreements'))
        .then((snap) => snap.docs.map((d) => d.data() as AgreementDoc))
        .catch((err) => {
          this.cache = null; // 失敗したら次回は読み直す
          throw err;
        });
    }
    return this.cache;
  }
}
