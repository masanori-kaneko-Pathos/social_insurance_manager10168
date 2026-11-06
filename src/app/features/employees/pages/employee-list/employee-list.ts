import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { ageAt, todayLocal } from '../../../../shared/utils/date';
import { OfficeContext } from '../../../office/office-context.service';
import { EmployeeService } from '../../employee.service';
import { groupByName, matchesName, RomanBy } from '../../logic/name-index';

import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
type StatusFilter = 'active' | 'retired' | 'all';

@Component({
  selector: 'app-employee-list',
  imports: [HalfWidthDigits, RouterLink, TranslocoPipe],
  templateUrl: './employee-list.html',
  styleUrl: './employee-list.css',
})
export class EmployeeList {
  private readonly employeesApi = inject(EmployeeService);
  readonly context = inject(OfficeContext);

  readonly today = todayLocal();
  readonly employees = signal<Employee[]>([]);
  readonly loading = signal(true);
  readonly query = signal('');
  readonly status = signal<StatusFilter>('active');
  /** ローマ字の列（A〜Z）を姓と名のどちらで並べるか */
  readonly romanBy = signal<RomanBy>('last');

  readonly filtered = computed(() => {
    const q = this.query();
    return this.employees().filter((e) => {
      const retired = this.isRetired(e);
      if (this.status() === 'active' && retired) return false;
      if (this.status() === 'retired' && !retired) return false;
      return matchesName(e, q);
    });
  });

  /** あ〜わ → A〜Z → # の見出しごと */
  readonly sections = computed(() => groupByName(this.filtered(), this.romanBy()));
  /** ローマ字の列に並ぶ人がいるときだけ「姓／名」の切り替えを出す */
  readonly hasRoman = computed(() => this.sections().some((s) => /^[A-Z]$/.test(s.label)));

  constructor() {
    // 事業所が切り替わったら読み直す
    effect(() => {
      const officeId = this.context.current()?.id;
      if (officeId) this.load(officeId);
    });
  }

  private async load(officeId: string): Promise<void> {
    this.loading.set(true);
    try {
      this.employees.set(await this.employeesApi.list(officeId));
    } catch (err) {
      console.error(err);
      this.employees.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  /** 退職日を過ぎていれば退職者（未来の退職日は「退職予定」で在籍中に含める） */
  isRetired(e: Employee): boolean {
    return !!e.retireDate && e.retireDate < this.today;
  }

  age(e: Employee): number {
    return ageAt(e.birthDate, this.today);
  }

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }
}
