import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { ageAt, todayLocal } from '../../../../shared/utils/date';
import { OfficeContext } from '../../../office/office-context.service';
import { EmployeeService } from '../../employee.service';

type StatusFilter = 'active' | 'retired' | 'all';

@Component({
  selector: 'app-employee-list',
  imports: [RouterLink, TranslocoPipe],
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

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.employees().filter((e) => {
      const retired = this.isRetired(e);
      if (this.status() === 'active' && retired) return false;
      if (this.status() === 'retired' && !retired) return false;
      if (!q) return true;
      const text = [e.lastName, e.firstName, e.lastNameKana, e.firstNameKana, e.employeeNumber ?? '']
        .join(' ')
        .toLowerCase();
      return text.includes(q);
    });
  });

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
