import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  Dependent,
  DEPENDENT_END_REASONS,
  INCOME_BASES,
  OCCUPATIONS,
  OVERSEAS_END_REASONS,
  OVERSEAS_REASONS,
  PHONE_TYPES,
  RELATIONSHIPS,
} from '../../../../core/models/dependent';
import { Employee } from '../../../../core/models/employee';
import { payTotal } from '../../../../core/models/payroll';
import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
import { ageAt, todayLocal } from '../../../../shared/utils/date';
import { formatYen, parseNat } from '../../../../shared/utils/number';
import { OfficeContext } from '../../../office/office-context.service';
import { PayrollService } from '../../../payrolls/payroll.service';
import { BonusService } from '../../../premiums/bonus.service';
import { DependentService } from '../../dependent.service';
import { EmployeeService } from '../../employee.service';
import {
  checkDependent,
  DependentCheck,
  insuredIncomeCandidate,
  isActiveOn,
} from '../../logic/dependent-check';
import {
  annualFromMonthly,
  contractWageCandidate,
  dependentErrors,
  DependentField,
  DependentFormValue,
  emptyDependentForm,
  fromDependentForm,
  sortDependents,
  startReasonsOf,
  toDependentForm,
} from '../../logic/dependent-form-model';

/**
 * 扶養家族（被扶養者（異動）届・第3号被保険者関係届の材料）
 * 入れた事実から「扶養の基準を満たしていそうか」の候補を横に出す。最後に決めるのは年金機構
 */
@Component({
  selector: 'app-dependent-card',
  imports: [HalfWidthDigits, ReactiveFormsModule, TranslocoPipe],
  templateUrl: './dependent-card.html',
  styleUrl: './dependent-card.css',
})
export class DependentCard implements OnInit {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(DependentService);
  private readonly employees = inject(EmployeeService);
  private readonly payrolls = inject(PayrollService);
  private readonly bonuses = inject(BonusService);
  readonly context = inject(OfficeContext);

  readonly employee = input.required<Employee>();
  /** 世帯の情報（従業員の文書）を保存したことを知らせる */
  readonly changed = output<void>();

  // ===== 選択肢 =====
  readonly relationships = RELATIONSHIPS;
  readonly occupations = OCCUPATIONS;
  readonly endReasons = DEPENDENT_END_REASONS;
  readonly phoneTypes = PHONE_TYPES;
  readonly overseasReasons = OVERSEAS_REASONS;
  readonly overseasEndReasons = OVERSEAS_END_REASONS;
  readonly incomeBases = INCOME_BASES;
  readonly yen = formatYen;
  readonly today = todayLocal();

  // ===== 箱 =====
  readonly rows = signal<Dependent[]>([]);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);
  /** null は閉じている、'new' は追加、それ以外は編集中の ID */
  readonly editing = signal<'new' | string | null>(null);
  readonly confirmingDelete = signal<string | null>(null);
  readonly saving = signal(false);
  readonly submitted = signal(false);
  /** 被保険者の年収の候補（給与・賞与の実績から） */
  readonly incomeCandidate = signal<{ amount: number; months: number } | null>(null);
  /** 世帯の情報を直しているか */
  readonly editingHousehold = signal(false);

  readonly form = this.fb.group(emptyDependentForm(''));
  private readonly value = signal<DependentFormValue>(this.form.getRawValue());

  readonly household = this.fb.group({ annualIncomeEstimate: '', spouseAnnualIncome: '' });

  // ===== 計算 =====

  /** 判定に使う被保険者の年収：手で入れた見込み → 実績からの候補 → わからない */
  readonly insuredIncome = computed<number | null>(
    () => this.employee().annualIncomeEstimate ?? this.incomeCandidate()?.amount ?? null,
  );

  readonly sorted = computed(() => sortDependents(this.rows(), this.today));

  readonly errors = computed(() => dependentErrors(this.value()));
  readonly isSpouse = computed(() => this.value().relationship === 'spouse');
  readonly startReasons = computed(() => startReasonsOf(this.value().relationship));
  readonly monthlyCandidate = computed(() => annualFromMonthly(this.value().monthlyIncome));
  readonly contractCandidate = computed(() => contractWageCandidate(this.value()));
  /** 入った日の候補：資格取得日・（出生なら）生年月日 */
  readonly fromCandidates = computed(() => {
    const v = this.value();
    const out: { key: string; date: string }[] = [];
    const acquired = this.employee().health.acquiredDate;
    if (acquired && acquired !== v.from) out.push({ key: 'acquired', date: acquired });
    if (v.startReason === 'birth' && v.birthDate && v.birthDate !== v.from) {
      out.push({ key: 'birth', date: v.birthDate });
    }
    return out;
  });

  /** 入力中の判定（扶養に入った日の時点） */
  readonly preview = computed<DependentCheck | null>(() => {
    const input = fromDependentForm(this.value());
    return input ? checkDependent(input, this.insuredIncome(), input.from) : null;
  });

  constructor() {
    this.form.valueChanges.subscribe(() => this.value.set(this.form.getRawValue()));
  }

  ngOnInit(): void {
    this.load();
  }

  private get officeId(): string | null {
    return this.context.current()?.id ?? null;
  }

  private async load(): Promise<void> {
    const officeId = this.officeId;
    if (!officeId) return;
    const id = this.employee().id;
    this.loading.set(true);
    try {
      const [rows, pays, bonuses] = await Promise.all([
        this.api.list(officeId, id),
        this.payrolls.listOfEmployee(officeId, id),
        this.bonuses.list(officeId),
      ]);
      this.rows.set(rows);
      this.incomeCandidate.set(
        insuredIncomeCandidate(
          {
            payrolls: pays.map((p) => ({ paidMonth: p.paidMonth, amount: payTotal(p) })),
            bonuses: bonuses
              .filter((b) => b.amounts[id] !== undefined)
              .map((b) => ({ paidDate: b.paidDate, amount: b.amounts[id] + (b.inKindAmounts?.[id] ?? 0) })),
          },
          this.today,
        ),
      );
    } catch (err) {
      console.error(err);
      this.errorKey.set('dependent.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  // ===== 表示の道具 =====

  errorOf(field: DependentField): string | null {
    const e = this.errors()[field];
    return this.submitted() && e ? `dependent.error.${e}` : null;
  }

  /** 一覧の判定（今日の時点。外れた人は出さない） */
  checkOf(d: Dependent): DependentCheck | null {
    return isActiveOn(d, this.today) ? checkDependent(d, this.insuredIncome(), this.today) : null;
  }

  isActive(d: Dependent): boolean {
    return d.to === null || this.today < d.to;
  }

  age(d: Dependent): number {
    return ageAt(d.birthDate, this.today);
  }

  // ===== 世帯の情報 =====

  startHousehold(): void {
    const e = this.employee();
    this.household.setValue({
      annualIncomeEstimate: e.annualIncomeEstimate == null ? '' : formatYen(e.annualIncomeEstimate),
      spouseAnnualIncome: e.spouseAnnualIncome == null ? '' : formatYen(e.spouseAnnualIncome),
    });
    this.editingHousehold.set(true);
  }

  async saveHousehold(): Promise<void> {
    const officeId = this.officeId;
    const v = this.household.getRawValue();
    const income = parseNat(v.annualIncomeEstimate);
    const spouse = parseNat(v.spouseAnnualIncome);
    if (!officeId || income === undefined || spouse === undefined) {
      this.errorKey.set('dependent.error.yen');
      return;
    }
    this.saving.set(true);
    this.errorKey.set(null);
    try {
      await this.employees.update(officeId, this.employee().id, {
        annualIncomeEstimate: income,
        spouseAnnualIncome: spouse,
      });
      this.editingHousehold.set(false);
      this.changed.emit(); // 詳細画面が従業員を読み直す → insuredIncome も変わる
    } catch (err) {
      console.error(err);
      this.errorKey.set('dependent.error.save');
    } finally {
      this.saving.set(false);
    }
  }

  // ===== 追加・編集・削除 =====

  private open(v: DependentFormValue, key: 'new' | string): void {
    this.form.setValue(v, { emitEvent: false });
    this.value.set(v);
    this.submitted.set(false);
    this.errorKey.set(null);
    this.editing.set(key);
  }

  startAdd(): void {
    this.open(emptyDependentForm(this.today), 'new');
  }

  startEdit(d: Dependent): void {
    this.open(toDependentForm(d), d.id);
  }

  cancel(): void {
    this.editing.set(null);
  }

  useFrom(date: string): void {
    this.form.controls.from.setValue(date);
  }

  useAnnual(amount: number | null): void {
    if (amount !== null) this.form.controls.annualIncome.setValue(formatYen(amount));
  }

  useContractWage(): void {
    const c = this.contractCandidate();
    if (c !== null) this.form.controls.contractAnnualWage.setValue(formatYen(c));
  }

  async save(): Promise<void> {
    this.submitted.set(true);
    const input = fromDependentForm(this.form.getRawValue());
    const officeId = this.officeId;
    if (!input || !officeId) return;
    const key = this.editing();
    this.saving.set(true);
    this.errorKey.set(null);
    try {
      if (key === 'new') await this.api.create(officeId, this.employee().id, input);
      else if (key) await this.api.update(officeId, this.employee().id, key, input);
      this.editing.set(null);
      await this.load();
    } catch (err) {
      console.error(err);
      this.errorKey.set('dependent.error.save');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(id: string): Promise<void> {
    const officeId = this.officeId;
    if (!officeId) return;
    this.saving.set(true);
    try {
      await this.api.delete(officeId, this.employee().id, id);
      this.confirmingDelete.set(null);
      await this.load();
    } catch (err) {
      console.error(err);
      this.errorKey.set('dependent.error.delete');
    } finally {
      this.saving.set(false);
    }
  }
}
