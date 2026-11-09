import { Injectable } from '@angular/core';
import { collection, doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../../core/firebase';
import { RemunerationInput } from '../../core/models/remuneration';
import { IrregularDecision, LeaveEndDecision } from '../../core/models/revision';

/**
 * 随時改定・休業終了時改定の反映
 * 改定の記録（届書の材料）と、改定月からの標準報酬を同時に書く（両方書けるか、何も書かないか）
 * 改定月の標準報酬がもうある人は、呼ぶ側で止める（上書きしない）
 */
@Injectable({ providedIn: 'root' })
export class RevisionService {
  private emp(officeId: string, employeeId: string) {
    return ['offices', officeId, 'employees', employeeId] as const;
  }

  private async reflect(
    kind: 'irregularDecisions' | 'leaveEndDecisions',
    d: IrregularDecision | LeaveEndDecision,
    r: RemunerationInput,
  ): Promise<void> {
    const base = this.emp(d.officeId, d.employeeId);
    const decRef = doc(collection(db, ...base, kind), d.startMonth);
    // 同じ起算月の記録が前に残っていたら更新（作成日時は変えない。ルールで確かめている）
    const exists = (await getDoc(decRef)).exists();
    const batch = writeBatch(db);
    if (exists) batch.update(decRef, { ...d, updatedAt: serverTimestamp() });
    else batch.set(decRef, { ...d, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(doc(collection(db, ...base, 'remunerations'), r.from), {
      ...r,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  }

  reflectIrregular(d: IrregularDecision, r: RemunerationInput): Promise<void> {
    return this.reflect('irregularDecisions', d, r);
  }

  reflectLeaveEnd(d: LeaveEndDecision, r: RemunerationInput): Promise<void> {
    return this.reflect('leaveEndDecisions', d, r);
  }
}
