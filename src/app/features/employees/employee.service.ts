import { Injectable, inject } from '@angular/core';
import { HistoryService } from './history.service';
import { addDoc, collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../../core/firebase';
import {
  CareExemption,
  Employee,
  EmployeeDoc,
  EmployeeFormInput,
  EmployeeFull,
  EmployeeInput,
  EmployeePrivate,
  employeeExtras,
  emptyPrivate,
  Leave,
  legacyPrivate,
  splitPrivate,
} from '../../core/models/employee';
import { changesOf } from './logic/history';
import { ContactDoc } from '../../core/models/employee';
import { FilingTaskInput } from '../../core/models/filing-task';
import { todayLocal } from '../../shared/utils/date';
import { FilingTaskService } from '../filings/filing-task.service';
import { MyNumberService } from '../my-number/my-number.service';
import { OfficeContext } from '../office/office-context.service';
import { addressChanges, addressFilingReasons, addressTasks } from './logic/address-filing';
import { nameFilingReasons } from '../requests/logic/life-events';

const kana = (e: Employee) => e.lastNameKana + e.firstNameKana;

@Injectable({ providedIn: 'root' })
export class EmployeeService {
  private readonly history = inject(HistoryService);
  private readonly tasks = inject(FilingTaskService);
  private readonly myNumbers = inject(MyNumberService);
  private readonly context = inject(OfficeContext);

  /**
   * 住所が変わったときの届出の宿題（被保険者住所変更届・組合への届け）
   * 住所が変わったときだけ、従業員の文書とマイナンバーの状態を読む（ふだんの保存で読み込みを増やさない）
   */
  async addressTasksFor(
    officeId: string,
    employeeId: string,
    before: ContactDoc,
    after: ContactDoc,
    factDate: string = todayLocal(),
  ): Promise<FilingTaskInput[]> {
    const fields = addressChanges(before, after);
    if (fields.length === 0) return [];
    const [e, entry] = await Promise.all([
      this.get(officeId, employeeId),
      this.myNumbers.entry(officeId, employeeId).catch(() => undefined),
    ]);
    if (!e) return [];
    const reasons = addressFilingReasons({
      contact: after,
      health: e.health,
      pension: e.pension,
      noAddressReason: e.foreign?.noAddressReason ?? null,
      myNumberRegistered: entry === undefined ? null : entry?.status === 'registered',
    });
    const kumiai = this.context.current()?.healthInsurer.type === 'kumiai';
    return addressTasks(employeeId, fields, reasons, kumiai, factDate);
  }

  private col(officeId: string) {
    return collection(db, 'offices', officeId, 'employees');
  }

  /** 事業所の従業員（フリガナ順） */
  async list(officeId: string): Promise<Employee[]> {
    const snap = await getDocs(this.col(officeId));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as EmployeeDoc) }))
      .sort((a, b) => kana(a).localeCompare(kana(b), 'ja'));
  }

  async get(officeId: string, employeeId: string): Promise<Employee | null> {
    const snap = await getDoc(doc(this.col(officeId), employeeId));
    return snap.exists() ? { id: snap.id, ...(snap.data() as EmployeeDoc) } : null;
  }

  // ===== 鍵付きの文書（連絡先・通勤・口座） =====

  private privateRef(officeId: string, employeeId: string) {
    return doc(this.col(officeId), employeeId, 'details', 'private');
  }

  /**
   * 鍵付きの文書を読む。まだない（移し替えの前）なら、従業員の文書に残っている古い項目を使う
   * 一般ユーザーは読めない（ルールで断られる）ので、空の形を返す（画面は「—」になる）
   */
  async getPrivate(officeId: string, employeeId: string, legacyFrom?: object): Promise<EmployeePrivate> {
    try {
      const snap = await getDoc(this.privateRef(officeId, employeeId));
      if (snap.exists()) {
        const d = snap.data() as EmployeePrivate;
        return { contact: d.contact, commute: d.commute, bankAccount: d.bankAccount };
      }
    } catch (err) {
      console.warn('鍵付きの文書を読めませんでした（一般ユーザーなど）', err);
      return emptyPrivate();
    }
    return (legacyFrom && legacyPrivate(legacyFrom)) || emptyPrivate();
  }

  /** 従業員の文書＋鍵付きの文書（詳細・編集・マイページ・依頼の確認）。読み込みは2回 */
  async getFull(officeId: string, employeeId: string): Promise<EmployeeFull | null> {
    const e = await this.get(officeId, employeeId);
    if (!e) return null;
    return { ...e, ...(await this.getPrivate(officeId, employeeId, e)) };
  }

  /** 鍵付きの文書を書く（変わったまとまりだけ重ねる。変更履歴は同じ batch） */
  /**
   * 氏名が変わったときの届出の宿題（被保険者氏名変更届）。要るかもしれない人だけ
   * マイナンバーの状態を1回読む（氏名が変わったときだけ）
   */
  async nameTasksFor(officeId: string, e: Pick<Employee, 'id' | 'health' | 'pension' | 'foreign'>, factDate: string): Promise<FilingTaskInput[]> {
    const entry = await this.myNumbers.entry(officeId, e.id).catch(() => undefined);
    const reasons = nameFilingReasons({
      myNumberRegistered: entry === undefined ? null : entry?.status === 'registered',
      healthEnrolled: e.health.enrolled,
      pensionEnrolled: e.pension.enrolled,
      kyokai: this.context.current()?.healthInsurer.type === 'kyokai',
      shortStay: e.foreign?.noAddressReason === 'shortStay',
    });
    return reasons.length > 0
      ? [{ kind: 'name', employeeId: e.id, factDate, fields: ['name', ...reasons.map((r) => `reason_${r}`)] }]
      : [];
  }

  private async writePrivate(
    officeId: string,
    employeeId: string,
    patch: Partial<EmployeePrivate>,
    addressFactDate?: string,
  ): Promise<void> {
    const ref = this.privateRef(officeId, employeeId);
    const snap = await getDoc(ref);
    const before = snap.exists()
      ? (snap.data() as EmployeePrivate)
      : (legacyPrivate((await this.get(officeId, employeeId)) ?? {}) ?? emptyPrivate());
    const after: EmployeePrivate = {
      contact: patch.contact ?? before.contact,
      commute: patch.commute ?? before.commute,
      bankAccount: patch.bankAccount ?? before.bankAccount,
    };
    const changes = changesOf(
      { contact: before.contact, commute: before.commute, bankAccount: before.bankAccount },
      { ...after },
    );
    if (snap.exists() && changes.length === 0) return; // 何も変わっていない
    // 住所が変わったら、届出の宿題も同じ batch で残す
    const tasks = await this.addressTasksFor(officeId, employeeId, before.contact, after.contact, addressFactDate);
    const batch = writeBatch(db);
    batch.set(ref, { ...after, updatedAt: serverTimestamp() });
    this.history.addTo(batch, officeId, employeeId, 'details/private', changes);
    for (const t of tasks) this.tasks.addTo(batch, officeId, t);
    await batch.commit();
  }

  // ===== 登録・編集 =====

  /**
   * 登録：画面が扱わない項目は初期値で埋める
   * 従業員の文書 → 鍵付きの文書 の順に、別々に書く（1回の判定でルールが数える式を少なくするため）
   */
  async create(officeId: string, input: EmployeeFormInput): Promise<string> {
    const { main, priv } = splitPrivate(input);
    const full: EmployeeInput = { ...employeeExtras(), ...main };
    const ref = await addDoc(this.col(officeId), {
      ...full,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await this.writePrivate(officeId, ref.id, priv);
    return ref.id;
  }

  /** 編集：渡した項目だけ書き換える（まとまりごとのカードもこれを使う）。鍵付きの文書の項目は分けて書く */
  async update(
    officeId: string,
    employeeId: string,
    input: Partial<EmployeeFormInput> | Partial<EmployeeInput>,
    /** 住所が変わった日（画面で入れたもの。なければ今日） */
    addressFactDate?: string,
  ): Promise<void> {
    const { main, priv } = splitPrivate(input as Partial<EmployeeFormInput>);
    // 書き込みと変更履歴は同じ batch（HistoryService）
    if (Object.keys(main).length > 0) {
      const ref = doc(this.col(officeId), employeeId);
      await this.history.write(officeId, employeeId, 'employee', ref, 'update', { ...main });
    }
    if (Object.keys(priv).length > 0) await this.writePrivate(officeId, employeeId, priv, addressFactDate);
  }

  /** 産休・育休だけを書き換える（ほかの項目には触らない） */
  async updateLeaves(officeId: string, employeeId: string, leaves: Leave[]): Promise<void> {
    const ref = doc(this.col(officeId), employeeId);
    await this.history.write(officeId, employeeId, 'employee', ref, 'update', { leaves });
  }

  /** 介護保険の適用除外だけを書き換える */
  async updateCareExemptions(
    officeId: string,
    employeeId: string,
    careExemptions: CareExemption[],
  ): Promise<void> {
    const ref = doc(this.col(officeId), employeeId);
    await this.history.write(officeId, employeeId, 'employee', ref, 'update', { careExemptions });
  }
}
