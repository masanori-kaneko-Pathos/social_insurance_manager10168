import { Injectable } from '@angular/core';
import { collection, doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../../core/firebase';
import { RegularDecision } from '../../core/models/regular-decision';
import { RemunerationInput } from '../../core/models/remuneration';

/** 定時決定の記録と、9月分の標準報酬への反映 */
@Injectable({ providedIn: 'root' })
export class RegularService {
  private emp(officeId: string, employeeId: string) {
    return ['offices', officeId, 'employees', employeeId] as const;
  }

  /** その年の記録（従業員ID → 記録） */
  async decisions(
    officeId: string,
    employeeIds: readonly string[],
    year: number,
  ): Promise<Map<string, RegularDecision>> {
    const snaps = await Promise.all(
      employeeIds.map((id) =>
        getDoc(doc(collection(db, ...this.emp(officeId, id), 'regularDecisions'), String(year))),
      ),
    );
    const map = new Map<string, RegularDecision>();
    snaps.forEach((s, i) => {
      if (s.exists()) {
        const { createdAt: _c, updatedAt: _u, ...rest } = s.data();
        map.set(employeeIds[i], rest as unknown as RegularDecision);
      }
    });
    return map;
  }

  /**
   * 反映：記録と 9月分の標準報酬を同時に書く（両方書けるか、何も書かないか）
   * 9月分の標準報酬がすでにある人は、呼ぶ側で止める（上書きしない）
   */
  async reflect(
    items: readonly { decision: RegularDecision; remuneration: RemunerationInput; decisionExists: boolean }[],
  ): Promise<void> {
    if (items.length === 0) return;
    if (items.length * 2 > 500) throw new Error('too many changes in one batch');
    const batch = writeBatch(db);
    for (const { decision: d, remuneration: r, decisionExists } of items) {
      const base = this.emp(d.officeId, d.employeeId);
      const decRef = doc(collection(db, ...base, 'regularDecisions'), d.year);
      if (decisionExists) {
        batch.update(decRef, { ...d, updatedAt: serverTimestamp() });
      } else {
        batch.set(decRef, { ...d, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      }
      batch.set(doc(collection(db, ...base, 'remunerations'), r.from), {
        ...r,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }
}
