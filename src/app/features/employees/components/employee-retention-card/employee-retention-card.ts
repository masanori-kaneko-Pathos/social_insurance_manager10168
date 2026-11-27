import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Employee } from '../../../../core/models/employee';
import { downloadCsv } from '../../../../shared/csv/csv';
import { ToastService } from '../../../../shared/services/toast.service';
import { todayLocal } from '../../../../shared/utils/date';
import { MyNumberService } from '../../../my-number/my-number.service';
import { OfficeContext } from '../../../office/office-context.service';
import { PayrollService } from '../../../payrolls/payroll.service';
import { BonusService } from '../../../premiums/bonus.service';
import { ContractService } from '../../contract.service';
import { EmployeeService } from '../../employee.service';
import { contractAt } from '../../logic/contract-form-model';
import { employeeExportTable } from '../../logic/employee-export';
import { deletableOn, retentionBase } from '../../logic/retention';
import { RemunerationService } from '../../remuneration.service';

/**
 * 保存期間を過ぎた退職者の削除（11/27。台帳 R110〜R113）。従業員の詳細の概要の上に、消せる日を過ぎた人だけ出す
 * - 消せる日：退職日・最後の給与の支払月の末日・最後の賞与の支払日のうち遅い日から5年の次の日（retention.ts）
 * - 消す前に、この人の従業員データを出力できる
 * - マイナンバーが残っていれば、先に廃棄してもらう（削除のボタンは押せない）
 * - 社員番号（番号がない人は姓）を入力してから消す。消せるかはサーバーでも数え直す
 */
@Component({
  selector: 'app-employee-retention-card',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './employee-retention-card.html',
  styleUrl: './employee-retention-card.css',
})
export class EmployeeRetentionCard {
  readonly employee = input.required<Employee>();

  private readonly api = inject(EmployeeService);
  private readonly payrolls = inject(PayrollService);
  private readonly bonuses = inject(BonusService);
  private readonly myNumbers = inject(MyNumberService);
  private readonly contractsApi = inject(ContractService);
  private readonly remApi = inject(RemunerationService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly context = inject(OfficeContext);

  readonly today = todayLocal();
  /** 数え始める日・消せる日（読み終えるまで null） */
  readonly dates = signal<{ base: string; from: string } | null>(null);
  /** マイナンバー（本人か家族）の記録が残っているか */
  readonly hasMyNumber = signal(false);
  /** 確認済みの月から外す数・賞与の支給から外す回数 */
  readonly bonusCount = signal(0);

  readonly due = computed(() => {
    const d = this.dates();
    return !!d && d.from <= this.today;
  });

  readonly open = signal(false);
  readonly typed = signal('');
  readonly busy = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly expected = computed(() => this.employee().employeeNumber || this.employee().lastName);
  readonly typedOk = computed(() => this.typed().trim() === this.expected().trim());

  constructor() {
    effect(() => {
      const e = this.employee();
      const office = this.context.current();
      if (office && this.context.isAdmin() && e.retireDate) void this.load(office.id, e);
    });
  }

  private async load(officeId: string, e: Employee): Promise<void> {
    try {
      const [pays, bonuses, entry, family] = await Promise.all([
        this.payrolls.listOfEmployee(officeId, e.id),
        this.bonuses.list(officeId),
        this.myNumbers.entry(officeId, e.id).catch(() => null),
        this.myNumbers.familyEntries(officeId, e.id).catch(() => new Map()),
      ]);
      const mine = bonuses.filter((b) => e.id in (b.amounts ?? {}) || e.id in (b.inKindAmounts ?? {}));
      const facts = {
        retireDate: e.retireDate,
        lastPaidMonth: pays.map((p) => p.paidMonth).sort().at(-1) ?? null,
        lastBonusDate: mine.map((b) => b.paidDate).sort().at(-1) ?? null,
      };
      const base = retentionBase(facts);
      const from = deletableOn(facts);
      this.dates.set(base && from ? { base, from } : null);
      this.bonusCount.set(mine.length);
      this.hasMyNumber.set(!!entry || family.size > 0);
    } catch (err) {
      console.error(err);
      this.dates.set(null);
    }
  }

  /** この人の従業員データ（従業員の一覧の出力と同じ列。契約は退職日の時点） */
  async exportOne(): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    const e = this.employee();
    try {
      const [contracts, rems, priv] = await Promise.all([
        this.contractsApi.list(office.id, e.id),
        this.remApi.list(office.id, e.id),
        this.api.getPrivate(office.id, e.id, e).catch(() => null),
      ]);
      const deptName = (id: string) => office.departments?.find((d) => d.id === id)?.name ?? null;
      const table = employeeExportTable(
        [{ employee: e, contract: contractAt(contracts, e.retireDate ?? this.today), remunerations: rems, private: priv }],
        deptName,
      );
      downloadCsv(`employee_${e.employeeNumber || e.id}_${this.today}.csv`, table);
    } catch (err) {
      console.error(err);
      this.errorKey.set('employee.retention.exportError');
    }
  }

  cancel(): void {
    this.open.set(false);
    this.typed.set('');
    this.errorKey.set(null);
  }

  async remove(): Promise<void> {
    const office = this.context.current();
    if (!office || !this.typedOk() || this.busy() || this.hasMyNumber()) return;
    this.busy.set(true);
    this.errorKey.set(null);
    try {
      await this.api.deleteRetained(office.id, this.employee().id, this.typed().trim());
      this.toast.show('employee.retention.done');
      await this.router.navigate(['/o', office.id, 'employees']);
    } catch (err) {
      console.error(err);
      const r = (err as { details?: { reason?: string } })?.details?.reason;
      this.errorKey.set(`employee.retention.error.${r ?? 'unknown'}`);
    } finally {
      this.busy.set(false);
    }
  }
}
