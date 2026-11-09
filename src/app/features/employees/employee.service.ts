import { Injectable, inject } from '@angular/core';
import { HistoryService } from './history.service';
import { addDoc, collection, doc, getDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../../core/firebase';
import {
  CareExemption,
  Employee,
  EmployeeBasicInput,
  EmployeeDoc,
  EmployeeInput,
  employeeExtras,
  Leave,
} from '../../core/models/employee';

const kana = (e: Employee) => e.lastNameKana + e.firstNameKana;

@Injectable({ providedIn: 'root' })
export class EmployeeService {
  private readonly history = inject(HistoryService);

  private col(officeId: string) {
    return collection(db, 'offices', officeId, 'employees');
  }

  /** 事業所の従業員（フリガナ順） */
  async list(officeId: string): Promise<Employee[]> {
    const snap = await getDocs(this.col(officeId));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as EmployeeDoc) }))
      .sort((a, b) => kana(a).localeCompare(kana(b), 'ja'));
  }

  async get(officeId: string, employeeId: string): Promise<Employee | null> {
    const snap = await getDoc(doc(this.col(officeId), employeeId));
    return snap.exists() ? { id: snap.id, ...(snap.data() as EmployeeDoc) } : null;
  }

  /** 登録：画面が扱わない項目は初期値で埋める */
  async create(officeId: string, input: EmployeeBasicInput): Promise<string> {
    const full: EmployeeInput = { ...employeeExtras(), ...input };
    const ref = await addDoc(this.col(officeId), {
      ...full,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  }

  /** 編集：渡した項目だけ書き換える（まとまりごとのカードもこれを使う） */
  async update(
    officeId: string,
    employeeId: string,
    input: EmployeeBasicInput | Partial<EmployeeInput>,
  ): Promise<void> {
    // 書き込みと変更履歴は同じ batch（HistoryService）
    const ref = doc(this.col(officeId), employeeId);
    await this.history.write(officeId, employeeId, 'employee', ref, 'update', { ...input });
  }

  /** 産休・育休だけを書き換える（ほかの項目には触らない） */
  async updateLeaves(officeId: string, employeeId: string, leaves: Leave[]): Promise<void> {
    const ref = doc(this.col(officeId), employeeId);
    await this.history.write(officeId, employeeId, 'employee', ref, 'update', { leaves });
  }

  /** 介護保険の適用除外だけを書き換える */
  async updateCareExemptions(
    officeId: string,
    employeeId: string,
    careExemptions: CareExemption[],
  ): Promise<void> {
    const ref = doc(this.col(officeId), employeeId);
    await this.history.write(officeId, employeeId, 'employee', ref, 'update', { careExemptions });
  }
}
