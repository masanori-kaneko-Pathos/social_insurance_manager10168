import { Injectable } from '@angular/core';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../core/firebase';
import { FilingTaskInput } from '../../core/models/filing-task';
import { insurerHistoryOf, premiumOf } from './office-settings';
import {
  FOR_EMPLOYEES_KEYS,
  Office,
  OfficeBasicInput,
  OfficeDoc,
  OfficeForEmployeesDoc,
  OfficeInput,
  officeExtras,
} from '../../core/models/office';

/** 従業員に見せてよい分だけを抜き出す */
function forEmployees(o: Pick<OfficeDoc, (typeof FOR_EMPLOYEES_KEYS)[number]>) {
  return {
    name: o.name,
    prefecture: o.prefecture,
    healthInsurer: o.healthInsurer,
    // 古いデータで履歴・設定がないときも、計算と同じ初期値で埋める（ルールが1行以上を求めるため）
    insurerHistory: insurerHistoryOf(o),
    premium: premiumOf(o),
  };
}

@Injectable({ providedIn: 'root' })
export class OfficeService {
  /** 事業所を作成し、自分の currentOfficeId をその事業所にする（同時に） */
  async create(uid: string, input: OfficeBasicInput | OfficeInput): Promise<string> {
    const officeRef = doc(collection(db, 'offices'));
    const batch = writeBatch(db);
    const full: OfficeInput = { ...officeExtras(), ...input };

    batch.set(officeRef, {
      ...full,
      memberUids: [uid],
      memberRoles: { [uid]: 'admin' },
      ownerUid: uid, // 作った人が代表（交代は関数 siUpdateMember）
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'users', uid), {
      currentOfficeId: officeRef.id,
      updatedAt: serverTimestamp(),
    });
    batch.set(this.sharedRef(officeRef.id), { ...forEmployees(full), updatedAt: serverTimestamp() });

    await batch.commit();
    return officeRef.id;
  }

  private sharedRef(officeId: string) {
    return doc(db, 'offices', officeId, 'shared', 'forEmployees');
  }

  /**
   * 従業員向けの写しを、事業所の今の設定で書き直す（設定の保存のあと・招待を作るときに呼ぶ）
   * 古い事業所で写しがまだないときも、これで作られる
   */
  async publishForEmployees(officeId: string): Promise<void> {
    const office = await this.get(officeId);
    if (!office) return;
    await setDoc(this.sharedRef(officeId), { ...forEmployees(office), updatedAt: serverTimestamp() });
  }

  /** 従業員向けの写し（マイページ。なければ null） */
  async getForEmployees(officeId: string): Promise<(OfficeForEmployeesDoc & { id: string }) | null> {
    const snap = await getDoc(this.sharedRef(officeId));
    return snap.exists() ? { id: officeId, ...(snap.data() as OfficeForEmployeesDoc) } : null;
  }

  /**
   * 事業所を更新する（メンバーと作成日時は変えない。ルールでも禁止している）
   * 届が要る変更があれば、届出の宿題（filingTasks）も同じ batch で残す（片方だけ保存されないように）
   */
  async update(
    officeId: string,
    input: OfficeBasicInput | Partial<OfficeInput>,
    tasks: readonly FilingTaskInput[] = [],
  ): Promise<void> {
    const batch = writeBatch(db);
    batch.update(doc(db, 'offices', officeId), {
      ...input,
      updatedAt: serverTimestamp(),
    });
    for (const t of tasks) {
      batch.set(doc(collection(db, 'offices', officeId, 'filingTasks')), {
        ...t,
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        doneAt: null,
      });
    }
    await batch.commit();
    // 従業員向けの写しも合わせる（失敗しても設定の保存は済んでいるので、止めずに残す）
    await this.publishForEmployees(officeId).catch((err) => console.error(err));
  }

  /** 自分が所属している事業所の一覧 */
  async listMine(uid: string): Promise<Office[]> {
    const q = query(collection(db, 'offices'), where('memberUids', 'array-contains', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as OfficeDoc) }));
  }

  /** 1件読む（メンバーでなければルールで拒否される） */
  async get(officeId: string): Promise<Office | null> {
    const snap = await getDoc(doc(db, 'offices', officeId));
    return snap.exists() ? { id: snap.id, ...(snap.data() as OfficeDoc) } : null;
  }

  /** 読めなければ null（存在しない・メンバーでない） */
  async tryGet(officeId: string): Promise<Office | null> {
    try {
      return await this.get(officeId);
    } catch (err) {
      if ((err as { code?: string }).code === 'permission-denied') return null;
      throw err;
    }
  }
}
