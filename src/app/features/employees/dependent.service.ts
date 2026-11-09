import { Injectable, inject } from '@angular/core';
import { collection, doc, getDocs } from 'firebase/firestore';
import { HistoryService } from './history.service';
import { db } from '../../core/firebase';
import { Dependent, DependentDoc, DependentInput } from '../../core/models/dependent';

/** 従業員ごとの扶養家族（ドキュメントIDは自動） */
@Injectable({ providedIn: 'root' })
export class DependentService {
  private readonly history = inject(HistoryService);

  private col(officeId: string, employeeId: string) {
    return collection(db, 'offices', officeId, 'employees', employeeId, 'dependents');
  }

  async list(officeId: string, employeeId: string): Promise<Dependent[]> {
    const snap = await getDocs(this.col(officeId, employeeId));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as DependentDoc) }));
  }

  /** 書き込みと変更履歴は同じ batch（HistoryService） */
  async create(officeId: string, employeeId: string, input: DependentInput): Promise<string> {
    const ref = doc(this.col(officeId, employeeId)); // 先に ID だけ作る
    await this.history.write(officeId, employeeId, `dependents/${ref.id}`, ref, 'set', { ...input });
    return ref.id;
  }

  async update(officeId: string, employeeId: string, id: string, input: DependentInput): Promise<void> {
    const ref = doc(this.col(officeId, employeeId), id);
    await this.history.write(officeId, employeeId, `dependents/${id}`, ref, 'update', { ...input });
  }

  async delete(officeId: string, employeeId: string, id: string): Promise<void> {
    const ref = doc(this.col(officeId, employeeId), id);
    await this.history.write(officeId, employeeId, `dependents/${id}`, ref, 'delete');
  }
}
