import { Injectable, inject } from '@angular/core';
import {
  collection,
  collectionGroup,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../core/firebase';
import { Payroll, PayrollInput } from '../../core/models/payroll';
import { HistoryService } from '../employees/history.service';
import { summarize } from '../employees/logic/history';

/** 履歴に残す項目（給与の実績の入力の項目だけ。誰の・どの月かは記録の target で分かる） */
function inputOf(p: PayrollInput | null | undefined): Record<string, unknown> | null {
  if (!p) return null;
  const { cash, fixed, inKind, retro, days, absentDays, workMinutes, prorated, state } = p;
  return { cash, fixed, inKind, retro, days, absentDays, workMinutes, prorated, state };
}

/** 1回の書き込みに入れる人数（1人 ＝ 実績1件 ＋ 履歴1件。batch の上限は500件） */
const PER_BATCH = 250;

/** 1人分の書き込み。input が null なら消す */
export interface PayrollChange {
  employeeId: string;
  input: PayrollInput | null;
  /** 保存済みか（作るか更新するかを分ける） */
  exists: boolean;
  /** 保存済みの中身（変更履歴の「変更前」。分からなければ省略） */
  before?: PayrollInput | null;
}

/** 複数の月にまたがる書き込み（CSV の取り込み） */
export interface PayrollWrite {
  employeeId: string;
  paidMonth: string;
  input: PayrollInput;
  exists: boolean;
  before?: PayrollInput | null;
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
 * 事業所の全員分は collectionGroup で読む（そのために officeId・employeeId・paidMonth を文書に入れている）
 */
@Injectable({ providedIn: 'root' })
export class PayrollService {
  private readonly history = inject(HistoryService);

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

  /**
   * 事業所の全員の全部（月の一覧・定時決定で使う）
   * collectionGroup の問い合わせ1回で読む（文書に officeId を入れてある。11/11 に人数分の読み込みから切り替え）
   * 渡した人の分だけ返す（退職者を除くなど、呼ぶ側の絞り込みはそのまま）
   */
  async listOfOffice(officeId: string, employeeIds: readonly string[]): Promise<Payroll[]> {
    const ids = new Set(employeeIds);
    const snap = await getDocs(query(collectionGroup(db, 'payrolls'), where('officeId', '==', officeId)));
    return snap.docs.map((d) => this.strip(d.data())).filter((p) => ids.has(p.employeeId));
  }

  /**
   * ある月の全員分（従業員ID → 実績）
   * collectionGroup の問い合わせ1回。読み込みは「その月に実績がある人の数」だけ（前は人数分を1件ずつ）
   */
  async month(
    officeId: string,
    employeeIds: readonly string[],
    paidMonth: string,
  ): Promise<Map<string, Payroll>> {
    const ids = new Set(employeeIds);
    const snap = await getDocs(
      query(collectionGroup(db, 'payrolls'), where('officeId', '==', officeId), where('paidMonth', '==', paidMonth)),
    );
    const map = new Map<string, Payroll>();
    for (const d of snap.docs) {
      const p = this.strip(d.data());
      if (ids.has(p.employeeId)) map.set(p.employeeId, p);
    }
    return map;
  }

  /**
   * 1か月分をまとめて書く。1人ごとに変更履歴を1件（変わった項目をまとめて）同じ batch に入れる
   * PER_BATCH 人までは「全部書けるか、何も書かないか」。それを超える人数は分けて書く
   */
  async saveMonth(officeId: string, paidMonth: string, changes: readonly PayrollChange[]): Promise<void> {
    for (let i = 0; i < changes.length; i += PER_BATCH) {
      await this.saveMonthChunk(officeId, paidMonth, changes.slice(i, i + PER_BATCH));
    }
  }

  private async saveMonthChunk(officeId: string, paidMonth: string, changes: readonly PayrollChange[]): Promise<void> {
    if (changes.length === 0) return;
    const batch = writeBatch(db);
    for (const c of changes) {
      const h = summarize(inputOf(c.before), inputOf(c.input));
      if (h) this.history.addTo(batch, officeId, c.employeeId, `payrolls/${paidMonth}`, [h]);
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
   * たくさんの書き込みを PER_BATCH 人ずつに分けて書く（1人 ＝ 実績1件 ＋ 履歴1件。1回の束は500件まで）
   * 1つの束の中は「全部か何もなし」。束をまたいで失敗したら PartialSaveError（何件目まで入ったか）
   */
  async saveMany(
    officeId: string,
    writes: readonly PayrollWrite[],
    onProgress?: (done: number) => void,
  ): Promise<void> {
    const SIZE = PER_BATCH;
    let done = 0;
    for (let i = 0; i < writes.length; i += SIZE) {
      const batch = writeBatch(db);
      for (const w of writes.slice(i, i + SIZE)) {
        const ref = doc(this.col(officeId, w.employeeId), w.paidMonth);
        const h = summarize(inputOf(w.before), inputOf(w.input));
        if (h) this.history.addTo(batch, officeId, w.employeeId, `payrolls/${w.paidMonth}`, [h]);
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
