import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { Payroll, PAYROLL_STATES } from '../../../../core/models/payroll';
import { ToastService } from '../../../../shared/services/toast.service';
import { daysInclusive, todayLocal } from '../../../../shared/utils/date';
import { candidateDays, PayrollRowText, readRow, RowError, sameInput, textOf, totalOf } from '../../logic/payroll-input';
import { OfficeContext } from '../../../office/office-context.service';
import { formatHours } from '../../../../shared/utils/number';
import { employedDuring, latestPaidMonth, periodOf, suggestDays } from '../../logic/payroll-rows';
import { payrollOf } from '../../../office/office-settings';
import { PayrollService } from '../../payroll.service';

/**
 * 従業員の詳細：給与の実績（直近12件）
 * 管理者は、この人の1か月分をここで入れる・直すこともできる（チェックは月の画面と同じ payroll-input.ts）
 */
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

  private readonly toast = inject(ToastService);
  /** この人の全部（新しい順）。入力の窓で、選んだ月の保存済みを探すのに使う */
  private readonly all = signal<Payroll[]>([]);
  readonly items = computed(() => this.all().slice(0, 12));
  /** 並び：新しい順（初期値）か古い順。画面の中だけ（保存しない） */
  readonly newestFirst = signal(true);
  readonly shown = computed(() => (this.newestFirst() ? this.items() : [...this.items()].reverse()));
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
      this.all.set(await this.api.listOfEmployee(office.id, employeeId));
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
    const { start, end } = periodOf(p.paidMonth, payrollOf(office));
    const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    return `${md(start)}〜${md(end)}`;
  }

  // ===== 1か月分の入力（管理者だけ） =====

  readonly states = PAYROLL_STATES;
  /** 入力している月（null は閉じている） */
  readonly editMonth = signal<string | null>(null);
  readonly draft = signal<PayrollRowText>(textOf(null));
  readonly errors = signal<RowError[]>([]);
  readonly saving = signal(false);
  readonly saveError = signal(false);

  private readonly savedOf = (month: string) => this.all().find((p) => p.paidMonth === month) ?? null;
  readonly editingSaved = computed(() => {
    const m = this.editMonth();
    return m ? this.savedOf(m) : null;
  });
  readonly editPeriod = computed(() => {
    const m = this.editMonth();
    const office = this.context.current();
    return m && office ? periodOf(m, payrollOf(office)) : null;
  });
  readonly editPeriodDays = computed(() => {
    const p = this.editPeriod();
    return p ? daysInclusive(p.start, p.end) : 0;
  });
  /** 対象期間に在籍していない月（入れられるが、知らせる） */
  readonly notEmployed = computed(() => {
    const p = this.editPeriod();
    return !!p && !employedDuring(this.employee(), p);
  });
  /** 日数の候補（在籍していた暦日数 − 欠勤日数） */
  readonly candidate = computed(() => {
    const p = this.editPeriod();
    return p ? candidateDays(suggestDays(this.employee(), p), this.draft().absentDays) : 0;
  });
  readonly total = computed(() => totalOf(this.draft().cash, this.draft().inKind));

  /** 開く：月を渡さなければ、支払日を過ぎた最新の月 */
  open(month?: string): void {
    const office = this.context.current();
    if (!office) return;
    this.startEdit(month ?? latestPaidMonth(todayLocal(), payrollOf(office)));
  }

  /** 月を変えたら、その月の保存済みを入れ直す（なければ空） */
  startEdit(month: string): void {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    this.editMonth.set(month);
    this.draft.set(textOf(this.savedOf(month)));
    this.errors.set([]);
    this.saveError.set(false);
  }

  close(): void {
    this.editMonth.set(null);
  }

  set<K extends keyof PayrollRowText>(key: K, value: PayrollRowText[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  fillCandidate(): void {
    this.set('days', String(this.candidate()));
  }

  async save(): Promise<void> {
    const office = this.context.current();
    const month = this.editMonth();
    if (!office || !month || this.saving()) return;
    const r = readRow(this.draft(), this.editPeriodDays());
    const before = this.editingSaved();
    if (r.kind === 'invalid') {
      this.errors.set(r.errors);
      return;
    }
    // 空のまま保存：保存済みなら消す、なければ何もしない（月の画面と同じ決まり）
    const input = r.kind === 'ok' ? r.input : null;
    if (input === null && !before) {
      this.errors.set(['cashRequired']);
      return;
    }
    if (input && before && sameInput(input, before)) {
      this.close();
      return;
    }
    this.errors.set([]);
    this.saveError.set(false);
    this.saving.set(true);
    try {
      await this.api.saveMonth(office.id, month, [
        { employeeId: this.employee().id, input, exists: !!before, before },
      ]);
      await this.load(this.employee().id);
      this.close();
      this.toast.show('common.saved');
    } catch (err) {
      console.error(err);
      this.saveError.set(true);
    } finally {
      this.saving.set(false);
    }
  }

  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  readonly hours = (m: number | null) => (m == null ? '—' : formatHours(m));
}
