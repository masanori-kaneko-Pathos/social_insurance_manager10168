import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { CARE_EXEMPTION_REASONS, CareExemption, Employee } from '../../../../core/models/employee';
import { todayLocal, toYearMonth } from '../../../../shared/utils/date';
import { OfficeContext } from '../../../office/office-context.service';
import { EmployeeService } from '../../employee.service';
import {
  careExemptionErrors,
  CareExemptionField,
  CareExemptionFormValue,
  careExemptionWarnings,
  careFilingStatus,
  careOverlaps,
  emptyCareExemptionForm,
  fromCareExemptionForm,
  toCareExemptionForm,
} from '../../logic/care-exemption';
import { ageReachDate } from '../../logic/coverage';

const NEW = 'new';
/** ルールの上限と同じ */
const MAX = 10;

interface Row {
  item: CareExemption;
  index: number;
  filing: ReturnType<typeof careFilingStatus>;
  /** 介護保険料がかからない月（同じ月に戻ったときは null） */
  months: { from: string; to: string | null } | null;
}

/** 従業員の詳細に出す「介護保険の適用除外」（海外居住・施設入所・在留3か月以下） */
@Component({
  selector: 'app-care-exemption-card',
  imports: [ReactiveFormsModule, TranslocoPipe],
  templateUrl: './care-exemption-card.html',
  styleUrl: '../leave-card/leave-card.css',
})
export class CareExemptionCard {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(EmployeeService);
  readonly context = inject(OfficeContext);

  readonly employee = input.required<Employee>();
  readonly changed = output<void>();

  readonly reasons = CARE_EXEMPTION_REASONS;
  readonly today = todayLocal();

  /** 介護保険の年齢（40歳到達日 〜 65歳到達日の前日） */
  readonly careAge = computed(() => {
    const b = this.employee().birthDate;
    return { from: ageReachDate(b, 40), to: ageReachDate(b, 65) };
  });

  readonly rows = computed<Row[]>(() =>
    (this.employee().careExemptions ?? [])
      .map((item, index) => ({ item, index, filing: careFilingStatus(item), months: monthsOf(item) }))
      .sort((a, b) => b.item.from.localeCompare(a.item.from)),
  );

  readonly editing = signal<typeof NEW | number | null>(null);
  readonly confirmingDelete = signal<number | null>(null);
  readonly saving = signal(false);
  readonly submitted = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly formErrorKey = signal<string | null>(null);

  readonly form = this.fb.group(emptyCareExemptionForm());
  private readonly value = signal<CareExemptionFormValue>(this.form.getRawValue());
  readonly errors = computed(() => careExemptionErrors(this.value()));
  readonly warnings = computed(() =>
    careExemptionWarnings(this.value(), this.careAge().from, this.careAge().to),
  );

  constructor() {
    this.form.valueChanges.subscribe(() => this.value.set(this.form.getRawValue()));
  }

  errorOf(field: CareExemptionField): string | null {
    const e = this.errors()[field];
    return this.submitted() && e ? `careExemption.error.${e}` : null;
  }

  private open(v: CareExemptionFormValue, mode: typeof NEW | number): void {
    this.form.setValue(v, { emitEvent: false });
    this.value.set(v);
    this.submitted.set(false);
    this.formErrorKey.set(null);
    this.errorKey.set(null);
    this.confirmingDelete.set(null);
    this.editing.set(mode);
  }

  startAdd(): void {
    this.open(emptyCareExemptionForm(), NEW);
  }

  startEdit(row: Row): void {
    this.open(toCareExemptionForm(row.item), row.index);
  }

  cancel(): void {
    this.editing.set(null);
  }

  async save(): Promise<void> {
    const mode = this.editing();
    if (mode === null || this.saving()) return;
    this.submitted.set(true);
    const item = fromCareExemptionForm(this.form.getRawValue());
    if (!item) return;
    const current = this.employee().careExemptions ?? [];
    if (mode === NEW && current.length >= MAX) {
      this.formErrorKey.set('careExemption.error.tooMany');
      return;
    }
    const others = current.filter((_, i) => i !== mode);
    if (careOverlaps(item, others)) {
      this.formErrorKey.set('careExemption.error.overlap');
      return;
    }
    this.formErrorKey.set(null);
    await this.write([...others, item]);
    if (!this.errorKey()) this.editing.set(null);
  }

  /** 「該当届を出した」「非該当届を出した」：今日の日付を入れる */
  async markFiled(index: number, which: 'start' | 'end'): Promise<void> {
    const current = this.employee().careExemptions ?? [];
    await this.write(
      current.map((e, i) =>
        i !== index ? e : which === 'start' ? { ...e, filedOn: this.today } : { ...e, endFiledOn: this.today },
      ),
    );
  }

  async remove(index: number): Promise<void> {
    const current = this.employee().careExemptions ?? [];
    await this.write(current.filter((_, i) => i !== index));
    if (!this.errorKey()) this.confirmingDelete.set(null);
  }

  private async write(items: CareExemption[]): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId) return;
    this.saving.set(true);
    this.errorKey.set(null);
    try {
      const sorted = [...items].sort((a, b) => a.from.localeCompare(b.from));
      await this.api.updateCareExemptions(officeId, this.employee().id, sorted);
      this.changed.emit();
    } catch (err) {
      console.error(err);
      this.errorKey.set('careExemption.error.save');
    } finally {
      this.saving.set(false);
    }
  }
}

/** かからない月の範囲（該当した月 〜 非該当の月の前月） */
function monthsOf(e: CareExemption): Row['months'] {
  const from = toYearMonth(e.from);
  if (!e.to) return { from, to: null };
  const toMonth = toYearMonth(e.to);
  if (toMonth <= from) return null;
  const [y, m] = toMonth.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  return { from, to: prev };
}
