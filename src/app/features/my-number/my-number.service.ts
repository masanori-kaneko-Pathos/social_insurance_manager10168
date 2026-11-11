import { Injectable } from '@angular/core';
import { collection, doc, getDoc, getDocs, query, Timestamp, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../core/firebase';
import {
  MyNumberAction,
  MyNumberDocType,
  MyNumberEntry,
  MyNumberLog,
} from '../../core/models/my-number';

/** 関数が断った理由（myNumber.reason.* の翻訳キーの最後）。分からなければ 'unknown' */
export function myNumberReason(err: unknown): string {
  const r = (err as { details?: { reason?: unknown } })?.details?.reason;
  return typeof r === 'string' ? r : 'unknown';
}

/**
 * マイナンバー
 * - 状態（番号は入っていない）：Firestore を読む（一覧は管理者、本人の分は管理者と本人）
 * - 番号の登録・提出・表示・書き出し・取り込み・廃棄：関数だけ（画面から番号の文書には触れない）
 */
@Injectable({ providedIn: 'root' })
export class MyNumberService {
  /** 事業所の全員分の状態（管理者。1回の読み取り） */
  async index(officeId: string): Promise<Map<string, MyNumberEntry>> {
    const snap = await getDoc(doc(db, 'offices', officeId, 'myNumberIndex', 'all'));
    const people = (snap.data()?.['people'] ?? {}) as Record<string, MyNumberEntry>;
    return new Map(Object.entries(people));
  }

  /** 1人の状態（管理者・本人） */
  async entry(officeId: string, employeeId: string): Promise<MyNumberEntry | null> {
    const snap = await getDoc(doc(db, 'offices', officeId, 'employees', employeeId, 'details', 'myNumber'));
    if (!snap.exists()) return null;
    const d = snap.data();
    const at = d['updatedAt'];
    return {
      status: d['status'],
      docType: d['docType'] ?? null,
      note: d['note'] ?? null,
      by: d['by'] ?? 'admin',
      updatedAt: at instanceof Timestamp ? at.toDate().toISOString() : String(at ?? ''),
    };
  }

  async act(
    officeId: string,
    employeeId: string,
    action: MyNumberAction,
    extra: { number?: string; docType?: MyNumberDocType | null; note?: string } = {},
  ): Promise<void> {
    await httpsCallable(functions, 'siMyNumberAdmin')({ officeId, employeeId, action, ...extra });
  }

  /** 本人の提出（マイページ） */
  async submit(number: string, docType: MyNumberDocType): Promise<void> {
    await httpsCallable(functions, 'siMyNumberSubmit')({ number, docType });
  }

  /** 全桁（呼ぶ前に AuthService.confirmPassword で確かめ直す） */
  async view(officeId: string, employeeId: string): Promise<string> {
    const r = await httpsCallable<unknown, { number: string }>(functions, 'siMyNumberView')({ officeId, employeeId });
    return r.data.number;
  }

  /** 登録済みの人の番号（呼ぶ前に確かめ直す） */
  async exportAll(officeId: string): Promise<{ employeeId: string; number: string }[]> {
    const r = await httpsCallable<unknown, { rows: { employeeId: string; number: string }[] }>(
      functions,
      'siMyNumberExport',
    )({ officeId });
    return r.data.rows;
  }

  async importMany(officeId: string, items: { employeeId: string; number: string }[]): Promise<number> {
    let done = 0;
    for (let i = 0; i < items.length; i += 500) {
      const r = await httpsCallable<unknown, { count: number }>(functions, 'siMyNumberImport')({
        officeId,
        items: items.slice(i, i + 500),
      });
      done += r.data.count;
    }
    return done;
  }

  /** アクセス記録（新しい順）。employeeId が null なら、まとめての書き出し・取り込みの分 */
  async logs(officeId: string, employeeId: string | null): Promise<MyNumberLog[]> {
    const snap = await getDocs(
      query(collection(db, 'offices', officeId, 'myNumberLogs'), where('employeeId', '==', employeeId)),
    );
    return snap.docs
      .map((d) => {
        const x = d.data();
        return {
          id: d.id,
          action: x['action'],
          employeeId: x['employeeId'] ?? null,
          count: x['count'] ?? 1,
          uid: x['uid'],
          name: x['name'] ?? '',
          at: x['at'] instanceof Timestamp ? x['at'].toDate() : null,
        } as MyNumberLog;
      })
      .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  }
}
