import { Injectable } from '@angular/core';
import {
  collection,
  deleteDoc,
  doc,
  documentId,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { countedGetDoc, countedGetDocs } from '../../core/read-meter';
import { auth, db } from '../../core/firebase';
import { MonthClose, MonthCloseDoc, SettlementDoc } from '../../core/models/month-close';
import { ClosePeople, peopleTotals, Settlement } from './logic/month-close';

/**
 * 月次確定（11/24）
 * - 確定：offices/{o}/monthCloses/{YYYY-MM}（1件。人数が多くても文書は1つなので、batch の上限には当たらない）
 * - 精算：offices/{o}/monthCloses/{YYYY-MM}/settlements/{従業員ID}
 * 確定の文書は書き換えない（ルールで update を禁止）。取り消しは削除（精算の記録も一緒に消す）
 */
@Injectable({ providedIn: 'root' })
export class MonthCloseService {
  private col(officeId: string) {
    return collection(db, 'offices', officeId, 'monthCloses');
  }
  private ref(officeId: string, month: string) {
    return doc(db, 'offices', officeId, 'monthCloses', month);
  }
  private settlementsCol(officeId: string, month: string) {
    return collection(db, 'offices', officeId, 'monthCloses', month, 'settlements');
  }

  /** その月の確定（なければ null） */
  async get(officeId: string, month: string): Promise<MonthClose | null> {
    const snap = await countedGetDoc(this.ref(officeId, month));
    return snap.exists() ? (snap.data() as MonthCloseDoc) : null;
  }

  /** 期間の確定（遡及計算で、確定時の額を訂正前にする。from 〜 to の月。両端を含む） */
  async range(officeId: string, from: string, to: string): Promise<MonthClose[]> {
    const q = query(this.col(officeId), where(documentId(), '>=', from), where(documentId(), '<=', to));
    const snap = await countedGetDocs(q);
    return snap.docs.map((d) => d.data() as MonthCloseDoc);
  }

  /** 新しい順に最大 n か月（突き合わせで、確定した月の差額をまとめて見る） */
  async latest(officeId: string, n: number): Promise<MonthClose[]> {
    const q = query(this.col(officeId), orderBy(documentId(), 'desc'), limit(n));
    const snap = await countedGetDocs(q);
    return snap.docs.map((d) => d.data() as MonthCloseDoc);
  }

  /** 確定する（作成だけ。同じ月がもうあればルールで止まる） */
  async close(officeId: string, month: string, people: ClosePeople): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error('not signed in');
    const t = peopleTotals(people);
    await setDoc(this.ref(officeId, month), {
      month,
      people,
      count: t.count,
      employeeYen: t.employeeYen,
      premiumTotalMilli: t.premiumTotalMilli,
      contributionMilli: t.contributionMilli,
      closedBy: user.uid,
      closedByName: user.displayName || user.email || null,
      closedAt: serverTimestamp(),
    });
  }

  /** 確定を取り消す（精算の記録を先に消してから、確定の文書を消す） */
  async cancel(officeId: string, month: string): Promise<void> {
    const snap = await countedGetDocs(this.settlementsCol(officeId, month));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db);
      for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref);
      await batch.commit();
    }
    await deleteDoc(this.ref(officeId, month));
  }

  /** その月の精算の記録（従業員ID → 記録） */
  async settlements(officeId: string, month: string): Promise<Record<string, Settlement>> {
    const snap = await countedGetDocs(this.settlementsCol(officeId, month));
    const out: Record<string, Settlement> = {};
    for (const d of snap.docs) {
      const { recordedBy: _b, recordedAt: _a, ...s } = d.data() as SettlementDoc;
      out[d.id] = s;
    }
    return out;
  }

  /** 精算済みにする（1人。前の記録があれば消してから作り直す：ルールは作成と削除だけ） */
  async settle(officeId: string, month: string, s: Settlement, replace: boolean): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('not signed in');
    const ref = doc(this.settlementsCol(officeId, month), s.employeeId);
    if (replace) await deleteDoc(ref);
    await setDoc(ref, { ...s, recordedBy: uid, recordedAt: serverTimestamp() });
  }

  /** 精算の記録を消す（間違えて押したとき） */
  async unsettle(officeId: string, month: string, employeeId: string): Promise<void> {
    await deleteDoc(doc(this.settlementsCol(officeId, month), employeeId));
  }
}
