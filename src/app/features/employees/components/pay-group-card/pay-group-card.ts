import { Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Employee } from '../../../../core/models/employee';
import type { PayrollSettings } from '../../../../core/models/office';
import { todayLocal, toYearMonth } from '../../../../shared/utils/date';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { OfficeContext } from '../../../office/office-context.service';
import { hasPayGroups, payGroupIdAt, payrollAt, withAssignment } from '../../../office/logic/pay-group';
import { EmployeeService } from '../../employee.service';

/**
 * 給与の支払区分の割り当て（11/24）
 * 「何月払いの給与から、どの区分か」を履歴で持つ。区分の決まり（締め日・支払日・控除の時期）は事業所の設定の画面で決める
 * 事業所に区分がない（既定の区分だけ）なら出さない
 */
@Component({
  selector: 'app-pay-group-card',
  imports: [TranslocoPipe],
  templateUrl: './pay-group-card.html',
  styleUrls: ['../leave-card/leave-card.css', './pay-group-card.css'],
})
export class PayGroupCard {
  readonly employee = input.required<Employee>();
  readonly changed = output<void>();

  private readonly api = inject(EmployeeService);
  private readonly transloco = inject(TranslocoService);
  readonly context = inject(OfficeContext);

  readonly thisMonth = toYearMonth(todayLocal());
  readonly show = computed(() => {
    const o = this.context.current();
    return !!o && (hasPayGroups(o) || (this.employee().payGroups ?? []).length > 0);
  });
  readonly groups = computed(() => this.context.current()?.payGroups ?? []);

  /** 今月払いの区分 */
  readonly currentName = computed(() => this.nameOf(payGroupIdAt(this.employee(), this.thisMonth)));
  readonly currentPayroll = computed(() => {
    const o = this.context.current();
    return o ? payrollAt(o, this.employee(), this.thisMonth) : null;
  });
  /** 履歴（新しい順。'0000-01' は「最初から」） */
  readonly history = computed(() => [...(this.employee().payGroups ?? [])].sort((a, b) => b.from.localeCompare(a.from)));

  readonly editing = signal(false);
  readonly from = signal('');
  readonly groupId = signal('');
  readonly saving = signal(false);
  readonly errorKey = signal<string | null>(null);

  nameOf(id: string | null): string {
    if (!id) return this.transloco.translate('payGroup.defaultName');
    return this.groups().find((g) => g.id === id)?.name ?? this.transloco.translate('payGroup.removed');
  }

  /** 決まりの1行（末日締め・翌月25日払い・翌月控除） */
  ruleText(p: PayrollSettings | null): string {
    if (!p) return '';
    const day = (d: number) => (d === 31 ? this.transloco.translate('office.day.end') : this.transloco.translate('office.day.n', { d }));
    return this.transloco.translate('payGroup.rule', {
      closing: day(p.closingDay),
      payMonth: this.transloco.translate('office.payMonth.' + p.payMonth),
      payDay: day(p.payDay),
      deduction: this.transloco.translate('payGroup.deduction.' + p.deduction),
    });
  }

  start(): void {
    this.from.set(this.thisMonth);
    this.groupId.set(payGroupIdAt(this.employee(), this.thisMonth) ?? '');
    this.errorKey.set(null);
    this.editing.set(true);
  }

  async save(): Promise<void> {
    const office = this.context.current();
    if (!office || this.saving()) return;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(this.from())) {
      this.errorKey.set('payGroup.error.from');
      return;
    }
    this.saving.set(true);
    this.errorKey.set(null);
    try {
      const payGroups = withAssignment(this.employee().payGroups, this.from(), this.groupId() || null);
      await this.api.update(office.id, this.employee().id, { payGroups });
      this.editing.set(false);
      this.changed.emit();
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'payGroup.error.save'));
    } finally {
      this.saving.set(false);
    }
  }

  monthLabel(ym: string): string {
    return ym === '0000-01'
      ? this.transloco.translate('payGroup.fromStart')
      : this.transloco.translate('payGroup.fromMonth', { y: ym.slice(0, 4), m: String(Number(ym.slice(5))) });
  }
}
