import { Injectable } from '@angular/core';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../core/firebase';
import { Payroll, PayrollInput } from '../../core/models/payroll';

/** 1人分の書き込み。input が null なら消す */
export interface PayrollChange {
  employeeId: string;
  input: PayrollInput | null;
  /** 保存済みか（作るか更新するかを分ける） */
  exists: boolean;
}

/** 複数の月にまたがる書き込み（CSV の取り込み） */
export interface PayrollWrite {
  employeeId: string;
  paidMonth: string;
  input: PayrollInput;
  exists: boolean;
}

/** 途中で失敗した（done 件までは保存済み） */
export class PartialSaveError extends Error {
  constructor(
    readonly done: number,
    readonly reason: unknown,
  ) {
    super(`saved ${done} before failing`);
  }
}

/**
 * 給与の実績（従業員の下。1人 × 1か月 ＝ 1件。ドキュメントIDは支払った月）
 * 月の全員分は、今は1人ずつ読む（人数分の読み込み）。人数が多くなったら collectionGroup に切り替える
 * （そのために officeId・employeeId を文書に入れている）
 */
@Injectable({ providedIn: 'root' })
export class PayrollService {
  private col(officeId: string, employeeId: string) {
    return collection(db, 'offices', officeId, 'employees', employeeId, 'payrolls');
  }

  private strip(data: Record<string, unknown>): Payroll {
    // createdAt・updatedAt は画面で使わないので落とす
    const { createdAt: _c, updatedAt: _u, ...rest } = data;
    return rest as unknown as Payroll;
  }

  /** 1人の全部（新しい順） */
  async listOfEmployee(officeId: string, employeeId: string): Promise<Payroll[]> {
    const snap = await getDocs(this.col(officeId, employeeId));
    return snap.docs
      .map((d) => this.strip(d.data()))
      .sort((a, b) => b.paidMonth.localeCompare(a.paidMonth));
  }

  /** 事業所の全員の全部（月の一覧で使う） */
  async listOfOffice(officeId: string, employeeIds: readonly string[]): Promise<Payroll[]> {
    const lists = await Promise.all(employeeIds.map((id) => this.listOfEmployee(officeId, id)));
    return lists.flat();
  }

  /** ある月の全員分（従業員ID → 実績） */
  async month(
    officeId: string,
    employeeIds: readonly string[],
    paidMonth: string,
  ): Promise<Map<string, Payroll>> {
    const snaps = await Promise.all(
      employeeIds.map((id) => getDoc(doc(this.col(officeId, id), paidMonth))),
    );
    const map = new Map<string, Payroll>();
    snaps.forEach((s, i) => {
      if (s.exists()) map.set(employeeIds[i], this.strip(s.data()));
    });
    return map;
  }

  /**
   * 1か月分をまとめて書く（全部書けるか、何も書かないか）
   * 1回の束は500件まで。それを超える人数は想定していない（超えたら分ける）
   */
  async saveMonth(officeId: string, paidMonth: string, changes: readonly PayrollChange[]): Promise<void> {
    if (changes.length === 0) return;
    if (changes.length > 500) throw new Error('too many changes in one batch');
    const batch = writeBatch(db);
    for (const c of changes) {
      const ref = doc(this.col(officeId, c.employeeId), paidMonth);
      if (c.input === null) {
        if (c.exists) batch.delete(ref);
      } else if (c.exists) {
        batch.update(ref, { ...c.input, updatedAt: serverTimestamp() });
      } else {
        batch.set(ref, {
          ...c.input,
          officeId,
          employeeId: c.employeeId,
          paidMonth,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
    await batch.commit();
  }

  /**
   * たくさんの書き込みを500件ずつに分けて書く（1回の束は500件まで）
   * 1つの束の中は「全部か何もなし」。束をまたいで失敗したら PartialSaveError（何件目まで入ったか）
   */
  async saveMany(
    officeId: string,
    writes: readonly PayrollWrite[],
    onProgress?: (done: number) => void,
  ): Promise<void> {
    const SIZE = 500;
    let done = 0;
    for (let i = 0; i < writes.length; i += SIZE) {
      const batch = writeBatch(db);
      for (const w of writes.slice(i, i + SIZE)) {
        const ref = doc(this.col(officeId, w.employeeId), w.paidMonth);
        if (w.exists) {
          batch.update(ref, { ...w.input, updatedAt: serverTimestamp() });
        } else {
          batch.set(ref, {
            ...w.input,
            officeId,
            employeeId: w.employeeId,
            paidMonth: w.paidMonth,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
      try {
        await batch.commit();
      } catch (err) {
        throw new PartialSaveError(done, err);
      }
      done = Math.min(writes.length, i + SIZE);
      onProgress?.(done);
    }
  }
}
