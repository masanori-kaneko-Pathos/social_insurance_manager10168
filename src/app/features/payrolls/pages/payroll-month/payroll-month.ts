import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { map } from 'rxjs';
import { Employee } from '../../../../core/models/employee';
import { PAYROLL_STATES, PayrollState } from '../../../../core/models/payroll';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import {
  candidateDays,
  PayrollRowText,
  readRow,
  RowError,
  sameInput,
  textOf,
  totalOf,
} from '../../logic/payroll-input';
import {
  hasExtra,
  latestPaidMonth,
  Period,
  PayrollRow,
  payrollRows,
  periodOf,
} from '../../logic/payroll-rows';
import { payrollOf } from '../../../office/office-settings';
import { MonthPicker } from '../../../../shared/components/month-picker/month-picker';
import { shiftMonth, daysInclusive, todayLocal, toYearMonth } from '../../../../shared/utils/date';
import { PayrollChange, PayrollService } from '../../payroll.service';

import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
import { InKindCalculator } from '../../components/in-kind-calculator/in-kind-calculator';
import { EnterNext } from '../../../../shared/directives/enter-next';
type RowForm = FormGroup<{
  cash: FormControl<string>;
  fixed: FormControl<string>;
  inKind: FormControl<string>;
  retro: FormControl<string>;
  days: FormControl<string>;
  absentDays: FormControl<string>;
  hours: FormControl<string>;
  prorated: FormControl<boolean>;
  state: FormControl<PayrollState>;
}>;

interface ViewRow {
  employee: Employee;
  row: PayrollRow;
  form: RowForm;
}

const MONTH_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

@Component({
  selector: 'app-payroll-month',
  imports: [EnterNext, HalfWidthDigits, InKindCalculator, MonthPicker, RouterLink, TranslocoPipe, ReactiveFormsModule],
  templateUrl: './payroll-month.html',
  styleUrl: './payroll-month.css',
})
export class PayrollMonth {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly employeesApi = inject(EmployeeService);
  private readonly payrollApi = inject(PayrollService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly context = inject(OfficeContext);

  readonly states = PAYROLL_STATES;

  readonly month = signal('');
  readonly period = signal<Period | null>(null);
  readonly views = signal<ViewRow[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly savedCount = signal<number | null>(null);
  /** 行ごとのエラー（従業員ID → エラー） */
  readonly rowErrors = signal<ReadonlyMap<string, RowError[]>>(new Map());

  /** すべての列を表示（?all=1） */
  readonly showAll = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('all') === '1')), {
    initialValue: false,
  });

  readonly periodDays = computed(() => {
    const p = this.period();
    return p ? daysInclusive(p.start, p.end) : 0;
  });
  readonly thisMonth = toYearMonth(todayLocal());

  /** 選び窓で選んだ月へ（前後の月のボタンと同じく、?all= などはそのまま） */
  goMonth(month: string): void {
    const officeId = this.context.current()?.id;
    if (officeId && month !== this.month()) {
      this.router.navigate(['/o', officeId, 'payrolls', month], { queryParamsHandling: 'preserve' });
    }
  }

  readonly prevMonth = computed(() => (this.month() ? shiftMonth(this.month(), -1) : ''));
  readonly nextMonth = computed(() => (this.month() ? shiftMonth(this.month(), 1) : ''));
  readonly isFuture = computed(() => {
    const office = this.context.current();
    return !!office && this.month() > latestPaidMonth(todayLocal(), payrollOf(office));
  });

  private employees: Employee[] | null = null;

  /** 現物給与の計算を開いている行（null は閉じている） */
  readonly inKindFor = signal<ViewRow | null>(null);

  openInKind(v: ViewRow): void {
    this.inKindFor.set(v);
  }

  /** 計算した額を現物の欄に入れる（保存は「保存する」で、ほかの欄と一緒に） */
  applyInKind(v: ViewRow, yen: number): void {
    v.form.controls.inKind.setValue(String(yen));
    v.form.markAsDirty();
    this.inKindFor.set(null);
  }

  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((p) => this.load(p.get('month') ?? ''));
  }

  private async load(month: string): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    this.loading.set(true);
    this.errorKey.set(null);
    this.savedCount.set(null);
    this.rowErrors.set(new Map());
    if (!MONTH_RE.test(month)) {
      this.errorKey.set('payroll.error.badMonth');
      this.loading.set(false);
      return;
    }
    this.month.set(month);
    this.inKindFor.set(null);
    try {
      this.employees ??= await this.employeesApi.list(office.id);
      const employees = this.employees;
      const period = periodOf(month, payrollOf(office));
      const saved = await this.payrollApi.month(
        office.id,
        employees.map((e) => e.id),
        month,
      );
      const byId = new Map(employees.map((e) => [e.id, e]));
      const views = payrollRows(employees, period, saved).map((row) => {
        const form = this.buildForm(textOf(row.saved));
        if (!this.context.isAdmin()) form.disable();
        return { employee: byId.get(row.employeeId)!, row, form };
      });
      this.period.set(period);
      this.views.set(views);
    } catch (err) {
      console.error(err);
      this.errorKey.set('payroll.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  private buildForm(t: PayrollRowText): RowForm {
    return this.fb.group({
      cash: t.cash,
      fixed: t.fixed,
      inKind: t.inKind,
      retro: t.retro,
      days: t.days,
      absentDays: t.absentDays,
      hours: t.hours,
      prorated: t.prorated,
      state: this.fb.control<PayrollState>(t.state),
    });
  }
  /** 合計の列（支払額＋現物）。読めないときは「—」 */
  total(v: ViewRow): string {
    const t = totalOf(v.form.controls.cash.value, v.form.controls.inKind.value);
    return t === null ? '—' : t.toLocaleString('ja-JP');
  }
  /** 日数の候補（在籍していた暦日数 − 欠勤日数） */
  candidate(v: ViewRow): number {
    return candidateDays(v.row.suggestedDays, v.form.controls.absentDays.value);
  }

  fillCandidate(v: ViewRow): void {
    v.form.controls.days.setValue(String(this.candidate(v)));
  }

  /** 日数が空欄の行に、まとめて候補を入れる */
  fillEmptyDays(): void {
    for (const v of this.views()) {
      if (v.form.controls.days.value.trim() === '') this.fillCandidate(v);
    }
  }

  /** 隠れた列に保存済みの値がある（すべての列を出していないときの印） */
  extraHidden(v: ViewRow): boolean {
    return !this.showAll() && !!v.row.saved && hasExtra(v.row.saved);
  }

  async save(): Promise<void> {
    const office = this.context.current();
    if (!office || !this.context.isAdmin() || this.saving()) return;
    this.savedCount.set(null);
    this.errorKey.set(null);

    const changes: PayrollChange[] = [];
    const errors = new Map<string, RowError[]>();
    for (const v of this.views()) {
      const r = readRow(v.form.getRawValue(), this.periodDays());
      const id = v.employee.id;
      if (r.kind === 'blank') {
        if (v.row.saved)
          changes.push({ employeeId: id, input: null, exists: true, before: v.row.saved });
      } else if (r.kind === 'invalid') {
        errors.set(id, r.errors);
      } else if (!v.row.saved || !sameInput(r.input, v.row.saved)) {
        changes.push({
          employeeId: id,
          input: r.input,
          exists: !!v.row.saved,
          before: v.row.saved ?? null,
        });
      }
    }
    this.rowErrors.set(errors);
    if (errors.size > 0) {
      // 1行でもおかしければ何も保存しない（どこまで保存されたか迷わないように）
      this.errorKey.set('payroll.error.rows');
      return;
    }

    this.saving.set(true);
    try {
      await this.payrollApi.saveMonth(office.id, this.month(), changes);
      await this.load(this.month());
      this.savedCount.set(changes.length);
    } catch (err) {
      console.error(err);
      this.errorKey.set('payroll.error.save');
    } finally {
      this.saving.set(false);
    }
  }

  readonly name = (e: Employee) => `${e.lastName} ${e.firstName}`;
  /** '2026-10-01' → '10/1' */
  readonly md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}
