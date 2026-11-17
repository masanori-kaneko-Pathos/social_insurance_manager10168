import { Injectable } from '@angular/core';
import { collection, doc, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '../../core/firebase';
import { countedGetDocs } from '../../core/read-meter';
import { decisionLinkRange, decisionTextJa, DecisionNotice, encodeDecision } from './logic/decision-notice';

/** 標準報酬月額の決定通知を、マイページの受信箱に届ける（B12。11/17） */
@Injectable({ providedIn: 'root' })
export class DecisionNoticeService {
  private col(officeId: string) {
    return collection(db, 'offices', officeId, 'notifications');
  }

  /** その月の決定通知を、もう送った人（従業員ID） */
  async sentFor(officeId: string, month: string): Promise<Set<string>> {
    const r = decisionLinkRange(month);
    const snap = await countedGetDocs(query(this.col(officeId), where('link', '>=', r.start), where('link', '<', r.end)));
    return new Set(snap.docs.map((d) => d.data()['employeeId'] as string));
  }

  /** まとめて送る（1回の書き込みは400件ずつ） */
  async send(officeId: string, items: readonly { employeeId: string; decision: DecisionNotice }[]): Promise<void> {
    for (let i = 0; i < items.length; i += 400) {
      const batch = writeBatch(db);
      for (const { employeeId, decision } of items.slice(i, i + 400)) {
        const t = decisionTextJa(decision);
        batch.set(doc(this.col(officeId)), {
          employeeId,
          kind: 'notice',
          title: t.title,
          body: t.body,
          link: encodeDecision(decision),
          readAt: null,
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
  }
}
