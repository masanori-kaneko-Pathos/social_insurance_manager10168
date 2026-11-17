import { Injectable, inject } from '@angular/core';
import { HistoryService } from '../employees/history.service';
import { changesOf } from '../employees/logic/history';
import { collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { countedGetDoc, countedGetDocs } from '../../core/read-meter';
import { db } from '../../core/firebase';
import { RemunerationInput } from '../../core/models/remuneration';
import { IrregularDecision, LeaveEndDecision, SpecialRevision, WageChange } from '../../core/models/revision';

/**
 * 随時改定・休業終了時改定の反映
 * 改定の記録（届書の材料）と、改定月からの標準報酬を同時に書く（両方書けるか、何も書かないか）
 * 改定月の標準報酬がもうある人は、呼ぶ側で止める（上書きしない）
 */
@Injectable({ providedIn: 'root' })
export class RevisionService {
  private readonly history = inject(HistoryService);

  private emp(officeId: string, employeeId: string) {
    return ['offices', officeId, 'employees', employeeId] as const;
  }

  private async reflect(
    kind: 'irregularDecisions' | 'leaveEndDecisions' | 'specialRevisions',
    d: IrregularDecision | LeaveEndDecision | SpecialRevision,
    r: RemunerationInput,
  ): Promise<void> {
    const base = this.emp(d.officeId, d.employeeId);
    // 随時改定・休業終了時改定は起算月、特例改定は改定月がID
    const decRef = doc(collection(db, ...base, kind), 'startMonth' in d ? d.startMonth : d.revisedFrom);
    // 同じ起算月の記録が前に残っていたら更新（作成日時は変えない。ルールで確かめている）
    const exists = (await countedGetDoc(decRef)).exists();
    const batch = writeBatch(db);
    if (exists) batch.update(decRef, { ...d, updatedAt: serverTimestamp() });
    else batch.set(decRef, { ...d, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    batch.set(doc(collection(db, ...base, 'remunerations'), r.from), {
      ...r,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    this.history.addTo(batch, d.officeId, d.employeeId, `remunerations/${r.from}`, changesOf(null, { ...r }));
    await batch.commit();
  }

  // ===== 固定的賃金の変動を、人が足す・外す（B11。ID ＝ 起算月。11/17） =====

  async wageChanges(officeId: string, employeeId: string): Promise<WageChange[]> {
    const snap = await countedGetDocs(collection(db, ...this.emp(officeId, employeeId), 'wageChanges'));
    return snap.docs.map((d) => {
      const { createdAt: _c, updatedAt: _u, ...rest } = d.data();
      return rest as unknown as WageChange;
    });
  }

  /** 同じ起算月があれば書き換える（足した ⇔ 外した の切り替えも同じ文書） */
  async saveWageChange(officeId: string, employeeId: string, w: WageChange): Promise<void> {
    const ref = doc(collection(db, ...this.emp(officeId, employeeId), 'wageChanges'), w.month);
    if ((await countedGetDoc(ref)).exists()) await updateDoc(ref, { ...w, updatedAt: serverTimestamp() });
    else await setDoc(ref, { ...w, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }

  async deleteWageChange(officeId: string, employeeId: string, month: string): Promise<void> {
    await deleteDoc(doc(collection(db, ...this.emp(officeId, employeeId), 'wageChanges'), month));
  }

  /** 随時改定の記録（届書の一覧で使う。渡した人の分だけ、1人1回の問い合わせ） */
  async irregularDecisions(officeId: string, employeeIds: readonly string[]): Promise<IrregularDecision[]> {
    const lists = await Promise.all(
      employeeIds.map((id) => countedGetDocs(collection(db, ...this.emp(officeId, id), 'irregularDecisions'))),
    );
    return lists.flatMap((snap) =>
      snap.docs.map((d) => {
        const { createdAt: _c, updatedAt: _u, ...rest } = d.data();
        return rest as unknown as IrregularDecision;
      }),
    );
  }

  reflectIrregular(d: IrregularDecision, r: RemunerationInput): Promise<void> {
    return this.reflect('irregularDecisions', d, r);
  }

  reflectLeaveEnd(d: LeaveEndDecision, r: RemunerationInput): Promise<void> {
    return this.reflect('leaveEndDecisions', d, r);
  }

  /** 特例改定：記録と、改定月からの標準報酬を同時に書く（11/16） */
  reflectSpecial(d: SpecialRevision, r: RemunerationInput): Promise<void> {
    return this.reflect('specialRevisions', d, r);
  }

  /** 特例改定の記録（届書の一覧で使う。渡した人の分だけ、1人1回の問い合わせ） */
  async specialRevisions(officeId: string, employeeIds: readonly string[]): Promise<SpecialRevision[]> {
    const lists = await Promise.all(
      employeeIds.map((id) => countedGetDocs(collection(db, ...this.emp(officeId, id), 'specialRevisions'))),
    );
    return lists.flatMap((snap) =>
      snap.docs.map((d) => {
        const { createdAt: _c, updatedAt: _u, ...rest } = d.data();
        return rest as unknown as SpecialRevision;
      }),
    );
  }
}
