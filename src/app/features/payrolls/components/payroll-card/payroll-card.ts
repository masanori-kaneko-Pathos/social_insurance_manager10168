import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { Payroll } from '../../../../core/models/payroll';
import { OfficeContext } from '../../../office/office-context.service';
import { formatHours } from '../../logic/payroll-input';
import { periodOf, scheduleOf } from '../../logic/payroll-rows';
import { PayrollService } from '../../payroll.service';

/** 従業員の詳細：給与の実績（直近12件・見るだけ。入力は月の画面で） */
@Component({
  selector: 'app-payroll-card',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './payroll-card.html',
  styleUrl: './payroll-card.css',
})
export class PayrollCard {
  private readonly api = inject(PayrollService);
  readonly context = inject(OfficeContext);

  readonly employee = input.required<Employee>();

  readonly items = signal<Payroll[]>([]);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);

  constructor() {
    effect(() => {
      const e = this.employee();
      this.load(e.id);
    });
  }

  private async load(employeeId: string): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    this.loading.set(true);
    try {
      this.items.set((await this.api.listOfEmployee(office.id, employeeId)).slice(0, 12));
    } catch (err) {
      console.error(err);
      this.errorKey.set('payroll.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  periodText(p: Payroll): string {
    const office = this.context.current();
    if (!office) return '';
    const { start, end } = periodOf(p.paidMonth, scheduleOf(office));
    const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    return `${md(start)}〜${md(end)}`;
  }

  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  readonly hours = (m: number | null) => (m == null ? '—' : formatHours(m));
}
