import { Injectable, inject } from '@angular/core';
import { HistoryService } from './history.service';
import { changesOf } from './logic/history';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../../core/firebase';
import { employeeExtras, splitPrivate } from '../../core/models/employee';
import { ImportItem } from './logic/employee-csv';

/** 1回の書き込み（batch）に入れる人数。1人 ＝ 従業員・鍵付きの文書・契約・標準報酬・履歴2件の6件まで（batch の上限は500件） */
const PER_BATCH = 80;

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
    /** 作った従業員（マイナンバーを関数へ渡すため） */
    onCreated: (item: ImportItem, employeeId: string) => void = () => undefined,
  ): Promise<number> {
    let done = 0;
    for (let i = 0; i < items.length; i += PER_BATCH) {
      const batch = writeBatch(db);
      const created: [ImportItem, string][] = [];
      for (const it of items.slice(i, i + PER_BATCH)) {
        const ref = doc(collection(db, 'offices', officeId, 'employees'));
        const stamps = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        // 連絡先・通勤・口座は鍵付きの文書へ（管理者と本人だけが読める）
        const { main, priv } = splitPrivate(it.employee);
        batch.set(ref, { ...employeeExtras(), ...main, leaves: it.leaves, ...stamps });
        batch.set(doc(collection(ref, 'details'), 'private'), { ...priv, updatedAt: serverTimestamp() });
        batch.set(doc(collection(ref, 'contracts'), it.contract.from), { ...it.contract, ...stamps });
        if (it.remuneration) {
          batch.set(doc(collection(ref, 'remunerations'), it.remuneration.from), { ...it.remuneration, ...stamps });
        }
        // 「CSV で登録した」ことを1件だけ残す（中身は登録した従業員の文書）
        this.history.addTo(batch, officeId, ref.id, 'employee', changesOf(null, { ...main, source: 'csv' }));
        this.history.addTo(batch, officeId, ref.id, 'details/private', changesOf(null, { ...priv }));
        created.push([it, ref.id]);
      }
      await batch.commit();
      for (const [it, id] of created) onCreated(it, id);
      done = Math.min(items.length, i + PER_BATCH);
      onProgress(done);
    }
    return done;
  }
}
