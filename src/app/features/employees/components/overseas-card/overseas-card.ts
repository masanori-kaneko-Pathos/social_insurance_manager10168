import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from '../../../../core/i18n/language.service';
import { Employee, Overseas, OVERSEAS_PAYERS } from '../../../../core/models/employee';
import { AgreementDoc } from '../../../../core/models/master';
import { todayLocal } from '../../../../shared/utils/date';
import { OfficeContext } from '../../../office/office-context.service';
import { AgreementService } from '../../agreement.service';
import { EmployeeService } from '../../employee.service';
import { ageReachDate } from '../../logic/coverage';
import { countryName, countryOptions } from '../../logic/foreign-options';
import {
  emptyOverseasForm,
  fromOverseasForm,
  overseasErrors,
  OverseasField,
  OverseasFormValue,
  overseasOn,
  overseasOverlaps,
  overseasWarnings,
  toOverseasForm,
} from '../../logic/overseas';

const NEW = 'new';
/** ルールの上限と同じ */
const MAX = 10;

interface Row {
  item: Overseas;
  index: number;
  name: string;
  now: boolean;
  agreement: boolean;
}

/** 従業員の詳細に出す「海外勤務」（赴任・在籍出向。給与の払い手と日本の適用証明書） */
@Component({
  selector: 'app-overseas-card',
  imports: [ReactiveFormsModule, TranslocoPipe],
  templateUrl: './overseas-card.html',
  styleUrl: '../leave-card/leave-card.css',
})
export class OverseasCard {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(EmployeeService);
  private readonly agreementsApi = inject(AgreementService);
  private readonly language = inject(LanguageService);
  readonly context = inject(OfficeContext);

  readonly employee = input.required<Employee>();
  readonly changed = output<void>();

  readonly payers = OVERSEAS_PAYERS;
  readonly today = todayLocal();
  readonly countries = computed(() => countryOptions(this.language.lang()));
  readonly agreements = signal<AgreementDoc[]>([]);

  readonly rows = computed<Row[]>(() =>
    (this.employee().overseas ?? [])
      .map((item, index) => ({
        item,
        index,
        name: countryName(item.country, this.language.lang()),
        now: overseasOn(item, this.today),
        agreement: this.agreements().some((a) => a.country === item.country),
      }))
      .sort((a, b) => b.item.from.localeCompare(a.item.from)),
  );

  readonly editing = signal<typeof NEW | number | null>(null);
  readonly confirmingDelete = signal<number | null>(null);
  readonly saving = signal(false);
  readonly submitted = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly formErrorKey = signal<string | null>(null);

  readonly form = this.fb.group(emptyOverseasForm());
  private readonly value = signal<OverseasFormValue>(this.form.getRawValue());
  readonly errors = computed(() => overseasErrors(this.value()));

  /** 選んだ国の協定（なければ null） */
  readonly agreement = computed(() => this.agreements().find((a) => a.country === this.value().country) ?? null);

  readonly warnings = computed(() => {
    const v = this.value();
    if (!v.country || !v.from || this.errors().from || this.errors().country) return [];
    const b = this.employee().birthDate;
    return overseasWarnings({
      item: {
        country: v.country,
        from: v.from,
        to: v.to || null,
        payer: v.payer,
        certificateFrom: v.certificateFrom || null,
        certificateTo: v.certificateTo || null,
      },
      agreements: this.agreements(),
      careAge: { from: ageReachDate(b, 40), to: ageReachDate(b, 65) },
      careExemptions: (this.employee().careExemptions ?? []).filter((c) => c.reason === 'overseas'),
    });
  });

  constructor() {
    this.form.valueChanges.subscribe(() => this.value.set(this.form.getRawValue()));
    this.agreementsApi.list().then(
      (list) => this.agreements.set(list),
      (err) => console.error(err), // 協定の一覧がなくても、入力と保存はできる（注意が出ないだけ）
    );
  }

  errorOf(field: OverseasField): string | null {
    const e = this.errors()[field];
    return this.submitted() && e ? `overseas.error.${e}` : null;
  }

  private open(v: OverseasFormValue, mode: typeof NEW | number): void {
    this.form.setValue(v, { emitEvent: false });
    this.value.set(v);
    this.submitted.set(false);
    this.formErrorKey.set(null);
    this.errorKey.set(null);
    this.confirmingDelete.set(null);
    this.editing.set(mode);
  }

  startAdd(): void {
    this.open(emptyOverseasForm(), NEW);
  }

  startEdit(row: Row): void {
    this.open(toOverseasForm(row.item), row.index);
  }

  cancel(): void {
    this.editing.set(null);
  }

  async save(): Promise<void> {
    const mode = this.editing();
    if (mode === null || this.saving()) return;
    this.submitted.set(true);
    const item = fromOverseasForm(this.form.getRawValue());
    if (!item) return;
    const current = this.employee().overseas ?? [];
    if (mode === NEW && current.length >= MAX) {
      this.formErrorKey.set('overseas.error.tooMany');
      return;
    }
    const others = current.filter((_, i) => i !== mode);
    if (overseasOverlaps(item, others)) {
      this.formErrorKey.set('overseas.error.overlap');
      return;
    }
    this.formErrorKey.set(null);
    await this.write([...others, item]);
    if (!this.errorKey()) this.editing.set(null);
  }

  async remove(index: number): Promise<void> {
    const current = this.employee().overseas ?? [];
    await this.write(current.filter((_, i) => i !== index));
    if (!this.errorKey()) this.confirmingDelete.set(null);
  }

  private async write(items: Overseas[]): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId) return;
    this.saving.set(true);
    this.errorKey.set(null);
    try {
      const sorted = [...items].sort((a, b) => a.from.localeCompare(b.from));
      await this.api.updateOverseas(officeId, this.employee().id, sorted);
      this.changed.emit();
    } catch (err) {
      console.error(err);
      this.errorKey.set('overseas.error.save');
    } finally {
      this.saving.set(false);
    }
  }
}
