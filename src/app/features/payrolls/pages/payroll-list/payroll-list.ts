import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { map } from 'rxjs';
import { Employee } from '../../../../core/models/employee';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import { employedDuring, insuredDuring, latestPaidMonth, Period, periodOf } from '../../logic/payroll-rows';
import { payrollOf } from '../../../office/office-settings';
import { shiftMonth, todayLocal } from '../../../../shared/utils/date';
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
  /** 月 → その月に実績が入っている人（月の索引。読んだ月だけ入る） */
  private readonly savedIds = signal<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);

  /** 支払日を過ぎた最新の月（＝ 実績が入っているべき月） */
  readonly latest = computed(() => {
    const office = this.context.current();
    return office ? latestPaidMonth(todayLocal(), payrollOf(office)) : '';
  });

  /** 一覧のいちばん上の月（?to=YYYY-MM。なければ最新の月の翌月まで見せる） */
  private readonly toParam = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('to'))), {
    initialValue: null,
  });
  readonly top = computed(() => {
    const to = this.toParam();
    return to && MONTH_RE.test(to) ? to : shiftMonth(this.latest(), 1);
  });

  /** 表に出す12か月（上が新しい） */
  private readonly months = computed(() => Array.from({ length: 12 }, (_, i) => shiftMonth(this.top(), -i)));

  readonly rows = computed<MonthRow[]>(() => {
    const office = this.context.current();
    if (!office || !this.latest()) return [];
    const schedule = payrollOf(office);
    const employees = this.employees();
    const savedIds = this.savedIds();
    return this.months().map((month) => {
      const period = periodOf(month, schedule);
      const saved = savedIds.get(month) ?? new Set<string>();
      const employed = employees.filter((e) => employedDuring(e, period));
      const future = month > this.latest();
      return {
        month,
        period,
        employed: employed.length,
        saved: employed.filter((e) => saved.has(e.id)).length,
        // 入れ忘れ：その期間に加入していて、実績がない人
        missing: future ? 0 : employed.filter((e) => insuredDuring(e, period) && !saved.has(e.id)).length,
        future,
      };
    });
  });

  readonly prevTo = computed(() => shiftMonth(this.top(), -12));
  /** 定時決定の年（6月払いが済んでいれば今年） */
  readonly regularYear = computed(() => (this.latest() ? regularYearOf(this.latest()) : 0));
  readonly nextTo = computed(() => shiftMonth(this.top(), 12));

  constructor() {
    // 前の1年・次の1年に移ったら、まだ読んでいない月の索引だけ読む
    effect(() => {
      const months = this.months();
      // 読み込みの中で触る値（読んだ月など）で、この effect が回り直さないように untracked
      if (months.length > 0 && this.latest()) untracked(() => this.load(months));
    });
  }

  /**
   * 従業員（最初の1回）と、月ごとの索引を読む（11/13）
   * 前は事業所の実績を全部読んでいた（約1,000人 × 12か月 ＝ 1万回以上）。今は1か月 ＝ 1回
   */
  private async load(months: readonly string[]): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    const todo = months.filter((m) => !this.savedIds().has(m));
    try {
      if (this.employees().length === 0) this.employees.set(await this.employeesApi.list(office.id));
      if (todo.length > 0) {
        const got = await this.payrollApi.savedIdsByMonth(office.id, todo, this.context.isAdmin());
        this.savedIds.update((cur) => new Map([...cur, ...got]));
      }
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
