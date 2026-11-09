import { Injectable } from '@angular/core';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../core/firebase';
import { InKindDoc } from '../../core/models/master';

/** 現物給与の価額（masterInKind）。全事業所共通で年に数回しか変わらないので、1回読んだら使い回す */
@Injectable({ providedIn: 'root' })
export class InKindService {
  private cache: Promise<InKindDoc[]> | null = null;

  list(): Promise<InKindDoc[]> {
    if (!this.cache) {
      this.cache = getDocs(collection(db, 'masterInKind'))
        .then((snap) => snap.docs.map((d) => d.data() as InKindDoc))
        .catch((err) => {
          this.cache = null; // 失敗したら次回は読み直す
          throw err;
        });
    }
    return this.cache;
  }
}
