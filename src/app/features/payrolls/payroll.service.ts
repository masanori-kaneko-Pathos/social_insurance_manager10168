import { Injectable, inject } from '@angular/core';
import {
  arrayRemove,
  arrayUnion,
  collection,
  collectionGroup,
  doc,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  WriteBatch,
} from 'firebase/firestore';
import { countedGetDoc, countedGetDocs } from '../../core/read-meter';
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

/**
 * 1回の書き込みに入れる人数（1人 ＝ 実績1件 ＋ 履歴1件。batch の上限は500件）
 * 月ごとの索引（payrollMonths）も同じ束に入るので、その分（月の数）を空けておく
 */
const PER_BATCH = 230;

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

/** 月の索引：その月に実績が入っている人（offices/{id}/payrollMonths/{YYYY-MM}） */
export interface PayrollMonthIndex {
  ids: string[];
  /** 実績を全部読んで作った索引か（false・なし ＝ 書き込みで足しただけで、前からある分が抜けているかもしれない） */
  complete?: boolean;
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

  private indexRef(officeId: string, paidMonth: string) {
    return doc(db, 'offices', officeId, 'payrollMonths', paidMonth);
  }

  /**
   * 月の索引に「入った人」を足す（同じ束に入れる。arrayUnion なので何度足しても1つ）
   * 消した人は束の外で外す（同じ文書に2回書くのを避けるため。消すのはまれ）
   */
  private addToIndex(batch: WriteBatch, officeId: string, added: ReadonlyMap<string, string[]>): void {
    for (const [month, ids] of added) {
      if (ids.length === 0) continue;
      batch.set(this.indexRef(officeId, month), { ids: arrayUnion(...ids), updatedAt: serverTimestamp() }, { merge: true });
    }
  }

  private async removeFromIndex(officeId: string, paidMonth: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await setDoc(
      this.indexRef(officeId, paidMonth),
      { ids: arrayRemove(...ids), updatedAt: serverTimestamp() },
      { merge: true },
    );
  }

  /**
   * 月ごとの「入力済みの人」（月の一覧で使う。11/13）
   * 全員の全部を読む（1年で約1万回）代わりに、月ごとの索引を1件ずつ読む（12か月で12回）
   * 索引がまだない月だけ、その月の実績を1回読んで索引を作る（管理者のときだけ保存。最初の1回だけかかる）
   */
  async savedIdsByMonth(officeId: string, months: readonly string[], canWrite: boolean): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    await Promise.all(
      months.map(async (m) => {
        const snap = await countedGetDoc(this.indexRef(officeId, m));
        const index = snap.exists() ? (snap.data() as PayrollMonthIndex) : null;
        if (index?.complete === true) {
          out.set(m, new Set(index.ids));
          return;
        }
        const docs = await countedGetDocs(
          query(collectionGroup(db, 'payrolls'), where('officeId', '==', officeId), where('paidMonth', '==', m)),
        );
        const ids = docs.docs.map((d) => d.data()['employeeId'] as string);
        out.set(m, new Set(ids));
        if (canWrite) {
          // 作れなくても一覧は出せるので、失敗は記録だけ
          await setDoc(this.indexRef(officeId, m), { ids, complete: true, updatedAt: serverTimestamp() }).catch((err) =>
            console.error(err),
          );
        }
      }),
    );
    return out;
  }

  /**
   * 月ごとの給与の合計額（支払額＋現物。月の一覧の「合計額」の欄。11/20）
   * 合計は索引に持たせず（取り込み・従業員のページなど、書く場所が多くてずれやすい）、その月の実績を読んで足す。
   * 1か月 ＝ その月に入っている人の数だけ読む。一覧は件数を先に出し、合計はあとから埋める
   */
  async totalsByMonth(officeId: string, months: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    await Promise.all(
      months.map(async (m) => {
        const docs = await countedGetDocs(
          query(collectionGroup(db, 'payrolls'), where('officeId', '==', officeId), where('paidMonth', '==', m)),
        );
        let sum = 0;
        for (const d of docs.docs) {
          const p = d.data() as Partial<PayrollInput>;
          sum += (p.cash ?? 0) + (p.inKind ?? 0);
        }
        out.set(m, sum);
      }),
    );
    return out;
  }

  private strip(data: Record<string, unknown>): Payroll {
    // createdAt・updatedAt は画面で使わないので落とす
    const { createdAt: _c, updatedAt: _u, ...rest } = data;
    return rest as unknown as Payroll;
  }

  /** 1人の全部（新しい順） */
  async listOfEmployee(officeId: string, employeeId: string): Promise<Payroll[]> {
    const snap = await countedGetDocs(this.col(officeId, employeeId));
    return snap.docs
      .map((d) => this.strip(d.data()))
      .sort((a, b) => b.paidMonth.localeCompare(a.paidMonth));
  }

  /**
   * 事業所の全員の、選んだ月の分だけ（定時決定・CSV の取り込みと出力で使う。11/16）
   * 全部を読むと、年数がたつほど読み込みが増える（1000人 × 5年 ＝ 6万回）。画面で使う月は決まっているので、その月だけ読む
   * in は1回に30個までなので、30か月ずつに分ける
   */
  async listOfOfficeMonths(officeId: string, employeeIds: readonly string[], months: readonly string[]): Promise<Payroll[]> {
    const ids = new Set(employeeIds);
    const unique = [...new Set(months)];
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += 30) chunks.push(unique.slice(i, i + 30));
    const snaps = await Promise.all(
      chunks.map((c) =>
        countedGetDocs(query(collectionGroup(db, 'payrolls'), where('officeId', '==', officeId), where('paidMonth', 'in', c))),
      ),
    );
    return snaps.flatMap((snap) => snap.docs.map((d) => this.strip(d.data()))).filter((p) => ids.has(p.employeeId));
  }

  /**
   * 事業所の全員の全部（今は使っていない。月を選べる listOfOfficeMonths を使う）
   * collectionGroup の問い合わせ1回で読む（文書に officeId を入れてある。11/11 に人数分の読み込みから切り替え）
   * 渡した人の分だけ返す（退職者を除くなど、呼ぶ側の絞り込みはそのまま）
   */
  async listOfOffice(officeId: string, employeeIds: readonly string[]): Promise<Payroll[]> {
    const ids = new Set(employeeIds);
    const snap = await countedGetDocs(query(collectionGroup(db, 'payrolls'), where('officeId', '==', officeId)));
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
    const snap = await countedGetDocs(
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
    await this.removeFromIndex(
      officeId,
      paidMonth,
      changes.filter((c) => c.input === null && c.exists).map((c) => c.employeeId),
    );
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
    const added = changes.filter((c) => c.input !== null).map((c) => c.employeeId);
    this.addToIndex(batch, officeId, new Map([[paidMonth, added]]));
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
      const added = new Map<string, string[]>();
      for (const w of writes.slice(i, i + SIZE)) {
        if (!added.has(w.paidMonth)) added.set(w.paidMonth, []);
        added.get(w.paidMonth)!.push(w.employeeId);
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
      this.addToIndex(batch, officeId, added);
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
