import { Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { auth } from '../../../../core/firebase';
import type { Employee } from '../../../../core/models/employee';
import type { Office } from '../../../../core/models/office';
import { ToastService } from '../../../../shared/services/toast.service';
import { shiftMonth, toYearMonth } from '../../../../shared/utils/date';
import { parseNat } from '../../../../shared/utils/number';
import { OfficeContext } from '../../../office/office-context.service';
import { EmployeeService } from '../../employee.service';
import type { TransferError, TransferPlan, TransferSource } from '../../logic/transfer';
import { TransferFailed, TransferService } from '../../transfer.service';

/**
 * 別の事業所へ異動する（転勤。11/24）
 * 1. 異動先・異動日・異動先の社員番号・報酬月額を入れる → 2.「内容を確かめる」で写す内容を見せる → 3.「異動する」
 * 異動先に従業員を作ってから、元の事業所で喪失させる（logic/transfer.ts・transfer.service.ts）
 */
@Component({
  selector: 'app-transfer-card',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './transfer-card.html',
  styleUrls: ['../leave-card/leave-card.css', './transfer-card.css'],
})
export class TransferCard {
  readonly employee = input.required<Employee>();
  /** 異動したあと（元の事業所の従業員を読み直す） */
  readonly changed = output<void>();

  private readonly api = inject(TransferService);
  private readonly employees = inject(EmployeeService);
  private readonly toast = inject(ToastService);
  readonly context = inject(OfficeContext);

  readonly open = signal(false);
  readonly toId = signal('');
  readonly date = signal('');
  readonly number = signal('');
  readonly amount = signal('');

  readonly busy = signal(false);
  readonly errors = signal<TransferError[]>([]);
  readonly failure = signal<{ step: string; newId: string | null } | null>(null);
  readonly source = signal<TransferSource | null>(null);
  readonly plan = signal<TransferPlan | null>(null);
  /** 異動を終えた（異動先の従業員） */
  readonly done = signal<{ officeId: string; employeeId: string; officeName: string } | null>(null);

  /** 異動先に選べる事業所：自分が管理者の、今の事業所以外 */
  readonly targets = computed<Office[]>(() => {
    const uid = auth.currentUser?.uid;
    const cur = this.context.current()?.id;
    return this.context.mine().filter((o) => o.id !== cur && !!uid && o.memberRoles[uid] === 'admin');
  });
  readonly target = computed(() => this.targets().find((o) => o.id === this.toId()) ?? null);

  start(): void {
    this.open.set(true);
    this.done.set(null);
    this.number.set(this.employee().employeeNumber ?? '');
    if (this.targets().length === 1) this.toId.set(this.targets()[0].id);
    this.reset();
  }

  cancel(): void {
    this.open.set(false);
    this.reset();
  }

  /** 入力を変えたら、確かめた内容を捨てる（古い内容で異動しないように） */
  reset(): void {
    this.plan.set(null);
    this.source.set(null);
    this.errors.set([]);
    this.failure.set(null);
  }

  set(field: 'toId' | 'date' | 'number' | 'amount', v: string): void {
    this[field].set(v);
    this.reset();
  }

  private input() {
    const a = this.amount().replace(/[,，円\s]/g, '');
    const n = a === '' ? null : parseNat(a);
    return { date: this.date(), employeeNumber: this.number(), monthlyAmount: n === undefined ? 0 : n };
  }

  async check(): Promise<void> {
    const from = this.context.current();
    const to = this.target();
    if (!from || !to || this.busy()) return;
    this.busy.set(true);
    this.reset();
    try {
      const full = await this.employees.getFull(from.id, this.employee().id);
      if (!full) return;
      const src = await this.api.source(from, to, full, this.date());
      const input = this.input();
      const errs = this.api.check(src, input);
      this.errors.set(errs);
      if (errs.length === 0) {
        this.source.set(src);
        this.plan.set(this.api.plan(src, input));
      }
    } catch (err) {
      console.error(err);
      this.failure.set({ step: 'load', newId: null });
    } finally {
      this.busy.set(false);
    }
  }

  async run(): Promise<void> {
    const from = this.context.current();
    const to = this.target();
    const plan = this.plan();
    if (!from || !to || !plan || this.busy()) return;
    this.busy.set(true);
    this.failure.set(null);
    try {
      const newId = await this.api.transfer(from, to, this.employee().id, plan);
      this.done.set({ officeId: to.id, employeeId: newId, officeName: to.name });
      this.plan.set(null);
      this.toast.show('transfer.done');
      this.changed.emit();
    } catch (err) {
      console.error(err);
      const f = err instanceof TransferFailed ? err : null;
      this.failure.set({ step: f?.step ?? 'unknown', newId: f?.newEmployeeId ?? null });
    } finally {
      this.busy.set(false);
    }
  }

  // ===== 表示 =====

  readonly lastMonth = computed(() => (/^\d{4}-\d{2}-\d{2}$/.test(this.date()) ? shiftMonth(toYearMonth(this.date()), -1) : ''));
  readonly firstMonth = computed(() => (/^\d{4}-\d{2}-\d{2}$/.test(this.date()) ? toYearMonth(this.date()) : ''));
  readonly currentAmount = computed(() => {
    const s = this.source();
    const m = this.firstMonth();
    if (!s || !m) return null;
    const list = s.remunerations.filter((r) => r.from <= m).sort((a, b) => b.from.localeCompare(a.from));
    return list[0]?.monthlyAmount ?? null;
  });
  monthParts(ym: string): { y: string; m: string } {
    return { y: ym.slice(0, 4), m: String(Number(ym.slice(5))) };
  }
  yen(n: number): string {
    return n.toLocaleString('ja-JP');
  }
}
