import { Injectable, computed, inject, signal } from '@angular/core';
import { Office } from '../../core/models/office';
import { groupOfficesByCorporation } from './office-grouping';
import { OfficeService } from './office.service';
import { AuthService } from '../../core/auth/auth.service';
import { OfficeRole } from '../../core/models/office';

@Injectable({ providedIn: 'root' })
export class OfficeContext {
  private readonly offices = inject(OfficeService);
  private readonly auth = inject(AuthService);

  private readonly _current = signal<Office | null>(null);
  private readonly _mine = signal<Office[]>([]);

  /** 今開いている事業所 */
  readonly current = this._current.asReadonly();
  /** 自分が所属している事業所の一覧 */
  readonly mine = this._mine.asReadonly();
  /** 切り替え用：法人ごとにまとめた一覧 */
  readonly groups = computed(() => groupOfficesByCorporation(this._mine()));
  /** 今の事業所での自分の権限 */
  readonly myRole = computed<OfficeRole | null>(() => {
    const uid = this.auth.user()?.uid;
    const office = this._current();
    return uid && office ? (office.memberRoles[uid] ?? null) : null;
  });
  readonly isAdmin = computed(() => this.myRole() === 'admin');

  setCurrent(office: Office): void {
    this._current.set(office);
  }

  async refresh(uid: string): Promise<void> {
    this._mine.set(await this.offices.listMine(uid));
  }

  clear(): void {
    this._current.set(null);
    this._mine.set([]);
  }
}