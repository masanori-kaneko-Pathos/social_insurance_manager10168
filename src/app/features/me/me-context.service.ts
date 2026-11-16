import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { EmployeeRef } from '../../core/models/app-user';
import { EmployeeFull } from '../../core/models/employee';
import { OfficeForEmployeesDoc } from '../../core/models/office';
import { EmployeeService } from '../employees/employee.service';
import { OfficeService } from '../office/office.service';
import { errorKeyOf } from '../../shared/utils/error-key';

export type MyOffice = OfficeForEmployeesDoc & { id: string };

/**
 * マイページの「自分」：users の employeeRef から、自分の従業員の文書と、事業所の設定の写しを読む
 * 3つの画面（トップ・依頼に答える・変更の申請）で使い回す。ログインしている人が変わったら読み直す
 */
@Injectable({ providedIn: 'root' })
export class MeContext {
  private readonly auth = inject(AuthService);
  private readonly employees = inject(EmployeeService);
  private readonly offices = inject(OfficeService);

  readonly office = signal<MyOffice | null>(null);
  readonly employee = signal<EmployeeFull | null>(null);
  readonly loading = signal(false);
  readonly errorKey = signal<string | null>(null);
  private loadedFor: string | null = null;

  ref(): EmployeeRef | null {
    return this.auth.profile()?.employeeRef ?? null;
  }

  async load(force = false): Promise<void> {
    const uid = this.auth.user()?.uid ?? null;
    const ref = this.ref();
    if (!uid || !ref) return;
    if (!force && this.loadedFor === uid && this.employee()) return;
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const [office, employee] = await Promise.all([
        this.offices.getForEmployees(ref.officeId),
        this.employees.getFull(ref.officeId, ref.employeeId),
      ]);
      this.office.set(office);
      this.employee.set(employee);
      this.loadedFor = uid;
      if (!employee) this.errorKey.set('me.error.noEmployee');
      else await this.syncName(employee);
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'me.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * 表示名は会社が登録した氏名にそろえる（11/16）
   * 従業員は招待で登録するときに表示名を入れない（会社が氏名を決めているので、入れてもらう意味がない）。
   * 登録の直後や、会社が氏名を直したあとに、マイページを開いたときに合わせる（失敗しても画面は止めない）
   */
  private async syncName(e: EmployeeFull): Promise<void> {
    const name = `${e.lastName} ${e.firstName}`.trim().slice(0, 50);
    if (!name || this.auth.profile()?.displayName === name) return;
    await this.auth.changeDisplayName(name).catch((err) => console.error(err));
  }
}
