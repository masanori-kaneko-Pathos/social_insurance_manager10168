import { Injectable, inject } from '@angular/core';
import { collection, doc } from 'firebase/firestore';
import { countedGetDoc, countedGetDocs } from '../../core/read-meter';
import { HistoryService } from './history.service';
import { db } from '../../core/firebase';
import { RemunerationDoc, RemunerationInput } from '../../core/models/remuneration';

/** 従業員ごとの標準報酬月額の履歴（ドキュメントIDは適用開始月） */
@Injectable({ providedIn: 'root' })
export class RemunerationService {
  private readonly history = inject(HistoryService);

  private col(officeId: string, employeeId: string) {
    return collection(db, 'offices', officeId, 'employees', employeeId, 'remunerations');
  }

  /** 新しい順 */
  async list(officeId: string, employeeId: string): Promise<RemunerationDoc[]> {
    const snap = await countedGetDocs(this.col(officeId, employeeId));
    return snap.docs
      .map((d) => d.data() as RemunerationDoc)
      .sort((a, b) => b.from.localeCompare(a.from));
  }

  /** 書き込みと変更履歴は同じ batch（HistoryService） */
  async create(officeId: string, employeeId: string, input: RemunerationInput): Promise<void> {
    const ref = doc(this.col(officeId, employeeId), input.from);
    await this.history.write(officeId, employeeId, `remunerations/${input.from}`, ref, 'set', { ...input });
  }

  async update(officeId: string, employeeId: string, input: RemunerationInput): Promise<void> {
    const ref = doc(this.col(officeId, employeeId), input.from);
    await this.history.write(officeId, employeeId, `remunerations/${input.from}`, ref, 'update', { ...input });
  }

  async delete(officeId: string, employeeId: string, from: string): Promise<void> {
    const ref = doc(this.col(officeId, employeeId), from);
    await this.history.write(officeId, employeeId, `remunerations/${from}`, ref, 'delete');
  }
}
