import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { map } from 'rxjs';
import { Employee } from '../../../../core/models/employee';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import { employedDuring, insuredDuring, latestPaidMonth, Period, periodOf } from '../../logic/payroll-rows';
import { payrollOf } from '../../../office/office-settings';
import { shiftMonth, todayLocal, toYearMonth, YearMonth } from '../../../../shared/utils/date';
import { MonthPicker } from '../../../../shared/components/month-picker/month-picker';
import { PayrollService } from '../../payroll.service';
import { regularYearOf } from '../../logic/regular';
import { errorKeyOf } from '../../../../shared/utils/error-key';

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

import { BackLink } from '../../../../shared/components/back-link/back-link';
@Component({
  selector: 'app-payroll-list',
  imports: [BackLink, MonthPicker, RouterLink, TranslocoPipe],
  templateUrl: './payroll-list.html',
  styleUrl: './payroll-list.css',
})
export class PayrollList {
  private readonly employeesApi = inject(EmployeeService);
  private readonly payrollApi = inject(PayrollService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly context = inject(OfficeContext);

  private readonly employees = signal<Employee[]>([]);
  /** 月 → その月に実績が入っている人（月の索引。読んだ月だけ入る） */
  private readonly savedIds = signal<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
  /** 月ごとの給与の合計額（支払額＋現物）。件数のあとから埋める（11/20） */
  readonly totals = signal<Map<string, number>>(new Map());
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
  /** いちばん新しく見せられる月（最新の月の翌月。それより先は実績がないので進めない。11/16） */
  readonly lastTop = computed(() => shiftMonth(this.latest(), 1));
  /** いちばん古い月（いちばん早い入社の月。それより前は在籍している人がいないので戻らない） */
  readonly firstMonth = computed(() => {
    const hires = this.employees().map((e) => toYearMonth(e.hireDate)).sort();
    return hires[0] ?? this.lastTop();
  });
  readonly top = computed(() => {
    const to = this.toParam();
    const want = to && MONTH_RE.test(to) ? to : this.lastTop();
    return this.clampTop(want);
  });

  /** いちばん上の月を、見せられる範囲に収める（表の12か月が、いちばん古い月を含むところまで） */
  private clampTop(m: YearMonth): YearMonth {
    const max = this.lastTop();
    if (m > max) return max;
    // 従業員を読み終わるまでは、古い側は収めない（読む前に URL の月を書き換えてしまわないように）
    if (this.employees().length === 0) return m;
    const floor = shiftMonth(this.firstMonth(), 11);
    const min = floor < max ? floor : max;
    return m < min ? min : m;
  }

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

  readonly prevTo = computed(() => this.clampTop(shiftMonth(this.top(), -12)));
  readonly canPrev = computed(() => this.prevTo() < this.top());
  /** 定時決定の年（6月払いが済んでいれば今年） */
  readonly regularYear = computed(() => (this.latest() ? regularYearOf(this.latest()) : 0));
  readonly nextTo = computed(() => this.clampTop(shiftMonth(this.top(), 12)));
  readonly canNext = computed(() => this.nextTo() > this.top());
  /** 表のいちばん古い月（見出しに「○年○月〜○年○月」と出す） */
  readonly bottom = computed(() => shiftMonth(this.top(), -11));
  readonly thisMonth = toYearMonth(todayLocal());

  /** 年と月を選んだ → その月をいちばん上にする（選んだ月が表に入るように） */
  goMonth(m: YearMonth): void {
    const to = this.clampTop(m);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { to: to === this.lastTop() ? null : to } });
  }

  monthLabel(m: string): { y: string; m: number } {
    return { y: m.slice(0, 4), m: Number(m.slice(5)) };
  }

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
      this.errorKey.set(errorKeyOf(err, 'payroll.error.load'));
    } finally {
      this.loading.set(false);
    }
    // 合計額は件数を出したあとで読む（一覧を待たせない。読めなくても一覧はそのまま。11/20）
    const need = months.filter((m) => !this.totals().has(m));
    if (need.length > 0) {
      this.payrollApi
        .totalsByMonth(office.id, need)
        .then((got) => this.totals.update((cur) => new Map([...cur, ...got])))
        .catch((err) => console.error(err));
    }
  }

  yen(n: number): string {
    return n.toLocaleString('ja-JP');
  }

  /** '2026-10-01' → '10/1' */
  readonly md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}
