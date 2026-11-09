import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { CHILD_TYPES, Employee, Leave, LEAVE_KINDS } from '../../../../core/models/employee';
import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
import { daysInclusive, todayLocal } from '../../../../shared/utils/date';
import { OfficeContext } from '../../../office/office-context.service';
import { EmployeeService } from '../../employee.service';
import { endOf, exemptRangeOf, isChildcareKind, isExemptKind } from '../../logic/leave';
import {
  childcareEarliest,
  emptyLeaveForm,
  extensionLimits,
  filingStatus,
  fromLeaveForm,
  isWithinMonth,
  leaveErrors,
  LeaveField,
  LeaveFormValue,
  leaveWarnings,
  markFiled,
  maternityRange,
  overlaps,
  toLeaveForm,
} from '../../logic/leave-form-model';

const NEW = 'new';
/** ルールの上限と同じ */
const MAX_LEAVES = 20;

interface Row {
  leave: Leave;
  index: number; // 保存されている配列の中の位置（編集・削除に使う）
  range: { from: string; to: string | null } | null;
  filing: ReturnType<typeof filingStatus>;
  /** 月の中で終わる育休：取得日数（就業予定日数は別に出す） */
  withinMonthDays: number | null;
}

/** 従業員の詳細に出す「休業」（産休・育休・出生時育休・介護休業・休職） */
@Component({
  selector: 'app-leave-card',
  imports: [HalfWidthDigits, ReactiveFormsModule, TranslocoPipe],
  templateUrl: './leave-card.html',
  styleUrl: './leave-card.css',
})
export class LeaveCard {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(EmployeeService);
  readonly context = inject(OfficeContext);

  readonly employee = input.required<Employee>();
  /** 保存・削除したことを知らせる（詳細画面が従業員を読み直し、保険料も計算し直す） */
  readonly changed = output<void>();

  readonly kinds = LEAVE_KINDS;
  readonly childTypes = CHILD_TYPES;
  readonly today = todayLocal();

  /** 新しい順 */
  readonly rows = computed<Row[]>(() => {
    const leaves = this.employee().leaves ?? [];
    return leaves
      .map((leave, index) => {
        const end = endOf(leave);
        return {
          leave,
          index,
          range: exemptRangeOf(leave, leaves),
          filing: filingStatus(leave),
          withinMonthDays: isWithinMonth(leave) && end ? daysInclusive(leave.start, end) : null,
        };
      })
      .sort((a, b) => b.leave.start.localeCompare(a.leave.start));
  });

  /** 'new' は追加、数字は編集中の位置、null は閉じている */
  readonly editing = signal<typeof NEW | number | null>(null);
  readonly confirmingDelete = signal<number | null>(null);
  readonly saving = signal(false);
  readonly submitted = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly formErrorKey = signal<string | null>(null);

  readonly form = this.fb.group(emptyLeaveForm());
  private readonly value = signal<LeaveFormValue>(this.form.getRawValue());

  readonly errors = computed(() => leaveErrors(this.value()));
  readonly warnings = computed(() => leaveWarnings(this.value(), this.employee().sex));
  readonly isMaternity = computed(() => this.value().kind === 'maternity');
  readonly isChildcare = computed(() => isChildcareKind(this.value().kind));
  readonly isExempt = computed(() => isExemptKind(this.value().kind));

  /** 産休にできる範囲 */
  readonly range = computed(() => {
    const v = this.value();
    return v.kind === 'maternity'
      ? maternityRange(v.expectedBirthDate || null, v.birthDate || null, v.multipleBirth)
      : null;
  });
  /** 育休のいちばん早い開始日（母親の実子） */
  readonly earliest = computed(() => {
    const v = this.value();
    return v.kind === 'childcare'
      ? childcareEarliest(v.childBirthDate || null, v.childType, this.employee().sex)
      : null;
  });
  /** 育休の終了予定日の上限（候補） */
  readonly limits = computed(() => {
    const v = this.value();
    return v.kind === 'childcare' ? extensionLimits(v.childBirthDate || null, v.papaMamaPlus) : [];
  });

  constructor() {
    this.form.valueChanges.subscribe(() => this.value.set(this.form.getRawValue()));
  }

  errorOf(field: LeaveField): string | null {
    const e = this.errors()[field];
    return this.submitted() && e ? `leave.error.${e}` : null;
  }

  // ===== 追加・編集・削除 =====

  private open(v: LeaveFormValue, mode: typeof NEW | number): void {
    this.form.setValue(v, { emitEvent: false });
    this.value.set(v);
    this.submitted.set(false);
    this.formErrorKey.set(null);
    this.errorKey.set(null);
    this.confirmingDelete.set(null);
    this.editing.set(mode);
  }

  startAdd(): void {
    this.open(emptyLeaveForm('childcare'), NEW);
  }

  startEdit(row: Row): void {
    this.open(toLeaveForm(row.leave), row.index);
  }

  cancel(): void {
    this.editing.set(null);
  }

  /** 候補の日付を入れる */
  use(field: 'start' | 'plannedEnd', date: string): void {
    this.form.controls[field].setValue(date);
  }

  async save(): Promise<void> {
    const mode = this.editing();
    if (mode === null || this.saving()) return;
    this.submitted.set(true);
    const current = this.employee().leaves ?? [];
    const base = mode === NEW ? null : current[mode];
    const leave = fromLeaveForm(this.form.getRawValue(), base);
    if (!leave) return;
    if (mode === NEW && current.length >= MAX_LEAVES) {
      this.formErrorKey.set('leave.error.tooMany');
      return;
    }
    const others = current.filter((_, i) => i !== mode);
    if (overlaps(leave, others)) {
      this.formErrorKey.set('leave.error.overlap');
      return;
    }
    this.formErrorKey.set(null);
    await this.write([...others, leave]);
    if (!this.errorKey()) this.editing.set(null);
  }

  /** 「届を出した」：今の中身を、出した届の中身として写す */
  async recordFiled(index: number): Promise<void> {
    const current = this.employee().leaves ?? [];
    await this.write(current.map((l, i) => (i === index ? markFiled(l, this.today) : l)));
  }

  async remove(index: number): Promise<void> {
    const current = this.employee().leaves ?? [];
    await this.write(current.filter((_, i) => i !== index));
    if (!this.errorKey()) this.confirmingDelete.set(null);
  }

  private async write(leaves: Leave[]): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId) return;
    this.saving.set(true);
    this.errorKey.set(null);
    try {
      const sorted = [...leaves].sort((a, b) => a.start.localeCompare(b.start));
      await this.api.updateLeaves(officeId, this.employee().id, sorted);
      this.changed.emit();
    } catch (err) {
      console.error(err);
      this.errorKey.set('leave.error.save');
    } finally {
      this.saving.set(false);
    }
  }
}
