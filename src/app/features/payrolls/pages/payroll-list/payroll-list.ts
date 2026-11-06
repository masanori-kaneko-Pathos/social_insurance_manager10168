import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { map } from 'rxjs';
import { Employee } from '../../../../core/models/employee';
import { Payroll } from '../../../../core/models/payroll';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import {
  addMonths,
  latestPaidMonth,
  missingPayrolls,
  Period,
  payrollRows,
  periodOf,
  scheduleOf,
  todayIso,
} from '../../logic/payroll-rows';
import { PayrollService } from '../../payroll.service';
import { regularYearOf } from '../../logic/regular';

interface MonthRow {
  month: string;
  period: Period;
  /** 対象期間に在籍していた人 */
  employed: number;
  /** そのうち入力済み */
  saved: number;
  /** 加入していて未入力（支払日を過ぎた月だけ数える） */
  missing: number;
  future: boolean;
}

const MONTH_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

@Component({
  selector: 'app-payroll-list',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './payroll-list.html',
  styleUrl: './payroll-list.css',
})
export class PayrollList {
  private readonly employeesApi = inject(EmployeeService);
  private readonly payrollApi = inject(PayrollService);
  private readonly route = inject(ActivatedRoute);
  readonly context = inject(OfficeContext);

  private readonly employees = signal<Employee[]>([]);
  private readonly payrolls = signal<Payroll[]>([]);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);

  /** 支払日を過ぎた最新の月（＝ 実績が入っているべき月） */
  readonly latest = computed(() => {
    const office = this.context.current();
    return office ? latestPaidMonth(todayIso(), scheduleOf(office)) : '';
  });

  /** 一覧のいちばん上の月（?to=YYYY-MM。なければ最新の月の翌月まで見せる） */
  private readonly toParam = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('to'))), {
    initialValue: null,
  });
  readonly top = computed(() => {
    const to = this.toParam();
    return to && MONTH_RE.test(to) ? to : addMonths(this.latest(), 1);
  });

  readonly rows = computed<MonthRow[]>(() => {
    const office = this.context.current();
    if (!office || !this.latest()) return [];
    const schedule = scheduleOf(office);
    const employees = this.employees();
    const byMonth = new Map<string, Map<string, Payroll>>();
    for (const p of this.payrolls()) {
      if (!byMonth.has(p.paidMonth)) byMonth.set(p.paidMonth, new Map());
      byMonth.get(p.paidMonth)!.set(p.employeeId, p);
    }
    return Array.from({ length: 12 }, (_, i) => {
      const month = addMonths(this.top(), -i);
      const period = periodOf(month, schedule);
      const saved = byMonth.get(month) ?? new Map<string, Payroll>();
      const rows = payrollRows(employees, period, saved);
      const future = month > this.latest();
      return {
        month,
        period,
        employed: rows.length,
        saved: rows.filter((r) => r.saved).length,
        missing: future ? 0 : missingPayrolls(employees, period, saved).length,
        future,
      };
    });
  });

  readonly prevTo = computed(() => addMonths(this.top(), -12));
  /** 定時決定の年（6月払いが済んでいれば今年） */
  readonly regularYear = computed(() => (this.latest() ? regularYearOf(this.latest()) : 0));
  readonly nextTo = computed(() => addMonths(this.top(), 12));

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    try {
      const employees = await this.employeesApi.list(office.id);
      const payrolls = await this.payrollApi.listOfOffice(
        office.id,
        employees.map((e) => e.id),
      );
      this.employees.set(employees);
      this.payrolls.set(payrolls);
    } catch (err) {
      console.error(err);
      this.errorKey.set('payroll.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  /** '2026-10-01' → '10/1' */
  readonly md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}
