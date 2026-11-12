import { Injectable, inject } from '@angular/core';
import { collection, doc } from 'firebase/firestore';
import { cached, cacheKey } from '../../core/data-cache';
import { countedGetDoc, countedGetDocs } from '../../core/read-meter';
import { HistoryService } from './history.service';
import { db } from '../../core/firebase';
import { ContractDoc, ContractInput } from '../../core/models/contract';

/** 従業員ごとの雇用契約の履歴（ドキュメントIDは契約が始まる日） */
@Injectable({ providedIn: 'root' })
export class ContractService {
  private readonly history = inject(HistoryService);

  private col(officeId: string, employeeId: string) {
    return collection(db, 'offices', officeId, 'employees', employeeId, 'contracts');
  }

  /** 新しい順。ログインしている間は覚えておく（core/data-cache.ts。書き込んだら HistoryService が忘れる） */
  async list(officeId: string, employeeId: string): Promise<ContractDoc[]> {
    const rows = await cached(cacheKey.contracts(officeId, employeeId), async () => {
      const snap = await countedGetDocs(this.col(officeId, employeeId));
      return snap.docs
        .map((d) => d.data() as ContractDoc)
        .sort((a, b) => b.from.localeCompare(a.from));
    });
    return [...rows];
  }

  /** 書き込みと変更履歴は同じ batch（HistoryService） */
  async create(officeId: string, employeeId: string, input: ContractInput): Promise<void> {
    const ref = doc(this.col(officeId, employeeId), input.from);
    await this.history.write(officeId, employeeId, `contracts/${input.from}`, ref, 'set', { ...input });
  }

  async update(officeId: string, employeeId: string, input: ContractInput): Promise<void> {
    const ref = doc(this.col(officeId, employeeId), input.from);
    await this.history.write(officeId, employeeId, `contracts/${input.from}`, ref, 'update', { ...input });
  }

  async delete(officeId: string, employeeId: string, from: string): Promise<void> {
    const ref = doc(this.col(officeId, employeeId), from);
    await this.history.write(officeId, employeeId, `contracts/${from}`, ref, 'delete');
  }
}
