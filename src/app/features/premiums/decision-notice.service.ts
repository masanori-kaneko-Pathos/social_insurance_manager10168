import { Injectable } from '@angular/core';
import { collection, doc, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '../../core/firebase';
import { countedGetDocs } from '../../core/read-meter';
import { decisionLinkRange, decisionTextJa, DecisionNotice, encodeDecision } from './logic/decision-notice';

/** 受信箱に届ける1通（title・body は日本語の控え。マイページは link から本人の言語で出す） */
export interface NoticeItem {
  employeeId: string;
  title: string;
  body: string;
  link: string;
}

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

  /**
   * link の範囲に入る、もう送った通知（「従業員ID|link」の集まり。11/19）
   * 同じ月に同じ人へ賞与が2回あるなど、人だけでは見分けられない通知に使う
   */
  async sentLinks(officeId: string, range: { start: string; end: string }): Promise<Set<string>> {
    const snap = await countedGetDocs(query(this.col(officeId), where('link', '>=', range.start), where('link', '<', range.end)));
    return new Set(snap.docs.map((d) => `${d.data()['employeeId']}|${d.data()['link']}`));
  }

  /** 標準賞与額・資格の取得と喪失の通知をまとめて送る（1回の書き込みは400件ずつ。11/19） */
  async sendNotices(officeId: string, items: readonly NoticeItem[]): Promise<void> {
    for (let i = 0; i < items.length; i += 400) {
      const batch = writeBatch(db);
      for (const n of items.slice(i, i + 400)) {
        batch.set(doc(this.col(officeId)), { ...n, kind: 'notice', readAt: null, createdAt: serverTimestamp() });
      }
      await batch.commit();
    }
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
