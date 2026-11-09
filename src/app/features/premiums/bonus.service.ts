import { Injectable, inject } from '@angular/core';
import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { HistoryService } from '../employees/history.service';
import { bonusChanges } from '../employees/logic/history';
import { db } from '../../core/firebase';
import { BonusPaymentDoc, BonusPayment, BonusPaymentInput } from '../../core/models/bonus';

/** 賞与の支給（事業所の下。1回の支給＝1件。ドキュメントIDは自動） */
@Injectable({ providedIn: 'root' })
export class BonusService {
  private readonly history = inject(HistoryService);

  private col(officeId: string) {
    return collection(db, 'offices', officeId, 'bonusPayments');
  }

  /** 新しい順（年度の累計を出すため、いつも全件を読む。1事業所で年に数件なので軽い） */
  async list(officeId: string): Promise<BonusPayment[]> {
    const snap = await getDocs(this.col(officeId));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as BonusPaymentDoc) }))
      .sort((a, b) => b.paidDate.localeCompare(a.paidDate));
  }

  /** 作ったドキュメントの ID を返す */
  async create(officeId: string, input: BonusPaymentInput): Promise<string> {
    const ref = doc(this.col(officeId)); // 先に ID だけ作る
    await this.write(officeId, ref.id, 'set', { inKindAmounts: {}, ...input });
    return ref.id;
  }

  /** amounts は丸ごと置き換わる（消した人は残らない） */
  async update(officeId: string, id: string, input: BonusPaymentInput): Promise<void> {
    await this.write(officeId, id, 'update', { ...input });
  }

  async delete(officeId: string, id: string): Promise<void> {
    await this.write(officeId, id, 'delete');
  }

  /**
   * 支給を書き、額が変わった人ごとに、その人の変更履歴（bonusPayments/支払日）を足す
   * 1回の書き込みは500件まで：支給1件 ＋ 履歴は先頭の450人分を同じ batch に、残りは続けて書く
   */
  private async write(
    officeId: string,
    id: string,
    op: 'set' | 'update' | 'delete',
    data: Partial<BonusPaymentDoc> = {},
  ): Promise<void> {
    const ref = doc(this.col(officeId), id);
    const snap = await getDoc(ref);
    const before = snap.exists() ? (snap.data() as BonusPaymentDoc) : null;
    const after = op === 'delete' ? null : { ...(before ?? {}), ...data };
    const paidDate = (after?.paidDate ?? before?.paidDate ?? id) as string;
    const changes = [...bonusChanges(before, after as Partial<BonusPaymentDoc> | null)];

    const FIRST = 450;
    const batch = writeBatch(db);
    if (op === 'set') batch.set(ref, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    else if (op === 'update') batch.update(ref, { ...data, updatedAt: serverTimestamp() });
    else batch.delete(ref);
    for (const [employeeId, c] of changes.slice(0, FIRST)) {
      this.history.addTo(batch, officeId, employeeId, `bonusPayments/${paidDate}`, [c]);
    }
    await batch.commit();
    for (let i = FIRST; i < changes.length; i += 490) {
      const rest = writeBatch(db);
      for (const [employeeId, c] of changes.slice(i, i + 490)) {
        this.history.addTo(rest, officeId, employeeId, `bonusPayments/${paidDate}`, [c]);
      }
      await rest.commit();
    }
  }
}
