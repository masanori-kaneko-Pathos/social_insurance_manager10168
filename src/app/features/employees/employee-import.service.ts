import { Injectable, inject } from '@angular/core';
import { HistoryService } from './history.service';
import { changesOf } from './logic/history';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../../core/firebase';
import { employeeExtras } from '../../core/models/employee';
import { ImportItem } from './logic/employee-csv';

/** 1回の書き込み（batch）に入れる人数。1人 ＝ 従業員・契約・標準報酬・履歴の4件まで（batch の上限は500件） */
const PER_BATCH = 120;

/**
 * 従業員の取り込み：1人分（従業員・最初の契約・標準報酬）は必ず同じ batch に入れる
 * → 途中で失敗しても「従業員だけあって契約がない」人はできない（PER_BATCH 人ずつ確定する）
 */
@Injectable({ providedIn: 'root' })
export class EmployeeImportService {
  private readonly history = inject(HistoryService);

  async importMany(
    officeId: string,
    items: readonly ImportItem[],
    onProgress: (done: number) => void = () => undefined,
  ): Promise<number> {
    let done = 0;
    for (let i = 0; i < items.length; i += PER_BATCH) {
      const batch = writeBatch(db);
      for (const it of items.slice(i, i + PER_BATCH)) {
        const ref = doc(collection(db, 'offices', officeId, 'employees'));
        const stamps = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        batch.set(ref, { ...employeeExtras(), ...it.employee, leaves: it.leaves, ...stamps });
        batch.set(doc(collection(ref, 'contracts'), it.contract.from), { ...it.contract, ...stamps });
        if (it.remuneration) {
          batch.set(doc(collection(ref, 'remunerations'), it.remuneration.from), { ...it.remuneration, ...stamps });
        }
        // 「CSV で登録した」ことを1件だけ残す（中身は登録した従業員の文書）
        this.history.addTo(batch, officeId, ref.id, 'employee', changesOf(null, { ...it.employee, source: 'csv' }));
      }
      await batch.commit();
      done = Math.min(items.length, i + PER_BATCH);
      onProgress(done);
    }
    return done;
  }
}
