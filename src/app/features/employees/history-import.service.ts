import { Injectable, inject } from '@angular/core';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../../core/firebase';
import { ContractService } from './contract.service';
import { HistoryService } from './history.service';
import { changesOf } from './logic/history';
import { HistoryItem, HistoryKind } from './logic/history-csv';
import { RemunerationService } from './remuneration.service';

/** 1回の書き込み（batch）に入れる件数。1件 ＝ 記録1件 ＋ 変更履歴1件（batch の上限は500件） */
const PER_BATCH = 200;
/** 登録済みの記録を、何人ずつ並べて読むか */
const READ_PARALLEL = 10;

/**
 * 履歴の取り込み：登録済みの従業員に、2回目からの契約・標準報酬の記録を足す
 * 同じ日（月）の記録は、計画（planHistoryImport）の時点で飛ばしてあるので、ここでは作るだけ
 */
@Injectable({ providedIn: 'root' })
export class HistoryImportService {
  private readonly history = inject(HistoryService);
  private readonly contracts = inject(ContractService);
  private readonly remunerations = inject(RemunerationService);

  /** 登録済みの記録の ID（ファイルに出てくる人の分だけ読む） */
  async existingIds(
    officeId: string,
    kind: HistoryKind,
    employeeIds: readonly string[],
  ): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    for (let i = 0; i < employeeIds.length; i += READ_PARALLEL) {
      const chunk = employeeIds.slice(i, i + READ_PARALLEL);
      const lists = await Promise.all(
        chunk.map((id) =>
          kind === 'contract' ? this.contracts.list(officeId, id) : this.remunerations.list(officeId, id),
        ),
      );
      chunk.forEach((id, j) => out.set(id, new Set(lists[j].map((d) => d.from))));
    }
    return out;
  }

  async importMany(
    officeId: string,
    items: readonly HistoryItem[],
    onProgress: (done: number) => void = () => undefined,
  ): Promise<number> {
    let done = 0;
    for (let i = 0; i < items.length; i += PER_BATCH) {
      const batch = writeBatch(db);
      for (const it of items.slice(i, i + PER_BATCH)) {
        const employee = doc(db, 'offices', officeId, 'employees', it.employeeId);
        const stamps = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        if (it.contract) {
          batch.set(doc(collection(employee, 'contracts'), it.id), { ...it.contract, ...stamps });
          this.history.addTo(batch, officeId, it.employeeId, `contracts/${it.id}`,
            changesOf(null, { ...it.contract, source: 'csv' }));
        } else if (it.remuneration) {
          batch.set(doc(collection(employee, 'remunerations'), it.id), { ...it.remuneration, ...stamps });
          this.history.addTo(batch, officeId, it.employeeId, `remunerations/${it.id}`,
            changesOf(null, { ...it.remuneration, source: 'csv' }));
        }
      }
      await batch.commit();
      done = Math.min(items.length, i + PER_BATCH);
      onProgress(done);
    }
    return done;
  }
}
