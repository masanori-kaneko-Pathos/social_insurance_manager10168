import { Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { CHANGE_DIRECTIONS, WAGE_CHANGE_KINDS, WageChange } from '../../../../core/models/revision';
import { todayLocal, toYearMonth } from '../../../../shared/utils/date';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { OfficeContext } from '../../../office/office-context.service';
import { directionOfKind, toWageChange, WageChangeForm, wageChangeErrors } from '../../logic/wage-change';
import { RevisionService } from '../../revision.service';

export interface WageChangeRow {
  employee: Employee;
  change: WageChange;
}

/**
 * 固定的賃金の変動を、人が足す・外す（B11。11/17）
 * 給与の実績から自動で見つからない変動（時給の改定・現物の変化など）を足す。足した・外したものの一覧から取り消せる
 * 外すのは、改定の候補の各行の「固定的賃金の変動ではない」から（ここでは一覧と取り消しだけ）
 */
@Component({
  selector: 'app-wage-change-card',
  imports: [TranslocoPipe],
  templateUrl: './wage-change-card.html',
  styleUrl: './wage-change-card.css',
})
export class WageChangeCard {
  private readonly api = inject(RevisionService);
  readonly context = inject(OfficeContext);

  /** 選べる人（社会保険に入っている人） */
  readonly employees = input.required<Employee[]>();
  /** 足した・外した変動（全員分） */
  readonly rows = input.required<WageChangeRow[]>();
  /** 改定の候補を出し始める月 */
  readonly fromMonth = input.required<string>();
  readonly saved = output<void>();

  readonly kinds = WAGE_CHANGE_KINDS;
  readonly directions = CHANGE_DIRECTIONS;
  readonly thisMonth = toYearMonth(todayLocal());

  readonly open = signal(false);
  readonly form = signal<WageChangeForm>({ employeeId: '', month: '', kind: '', direction: '', note: '' });
  readonly tried = signal(false);
  readonly busy = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly confirmDelete = signal<string | null>(null);

  readonly choices = computed(() =>
    this.employees()
      .filter((e) => e.health.enrolled || e.pension.enrolled)
      .sort((a, b) => (a.employeeNumber ?? '').localeCompare(b.employeeNumber ?? '')),
  );
  readonly errors = computed(() => wageChangeErrors(this.form(), { fromMonth: this.fromMonth(), thisMonth: this.thisMonth }));
  readonly sorted = computed(() =>
    [...this.rows()].sort((a, b) => b.change.month.localeCompare(a.change.month) || (a.employee.employeeNumber ?? '').localeCompare(b.employee.employeeNumber ?? '')),
  );
  /** 同じ人・同じ月がもうある（書き換える） */
  readonly overwrites = computed(() => {
    const f = this.form();
    return this.rows().find((r) => r.employee.id === f.employeeId && r.change.month === f.month) ?? null;
  });

  readonly name = (e: Employee) => `${e.lastName} ${e.firstName}`.trim();

  set<K extends keyof WageChangeForm>(key: K, value: WageChangeForm[K]): void {
    const next = { ...this.form(), [key]: value };
    // 種類を選んだら、向きの初期値を入れる（向きをまだ選んでいなければ）
    if (key === 'kind' && !this.form().direction) next.direction = directionOfKind(value as WageChangeForm['kind']);
    this.form.set(next);
  }

  errorOf(key: keyof WageChangeForm): string | null {
    const e = this.errors()[key];
    return this.tried() && e ? `wageChange.error.${e}` : null;
  }

  async add(): Promise<void> {
    this.tried.set(true);
    const officeId = this.context.current()?.id;
    if (!officeId || Object.keys(this.errors()).length > 0 || this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(null);
    try {
      const f = this.form();
      await this.api.saveWageChange(officeId, f.employeeId, toWageChange(f, 'manual'));
      this.form.set({ employeeId: '', month: '', kind: '', direction: '', note: '' });
      this.tried.set(false);
      this.open.set(false);
      this.saved.emit();
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'wageChange.error.save'));
    } finally {
      this.busy.set(false);
    }
  }

  /** 1回目で確認、2回目で取り消す（足した・外したことをなかったことにする） */
  async remove(r: WageChangeRow): Promise<void> {
    const key = `${r.employee.id}_${r.change.month}`;
    if (this.confirmDelete() !== key) {
      this.confirmDelete.set(key);
      return;
    }
    const officeId = this.context.current()?.id;
    if (!officeId || this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(null);
    try {
      await this.api.deleteWageChange(officeId, r.employee.id, r.change.month);
      this.confirmDelete.set(null);
      this.saved.emit();
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'wageChange.error.save'));
    } finally {
      this.busy.set(false);
    }
  }
}
