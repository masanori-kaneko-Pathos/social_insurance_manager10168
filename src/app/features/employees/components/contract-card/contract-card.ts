import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  ContractDoc,
  DISPATCH_TYPES,
  EMPLOYMENT_TYPES,
  PAY_TYPES,
  RENEWAL_TYPES,
  SPECIAL_EMPLOYMENTS,
  STUDENT_TYPES,
} from '../../../../core/models/contract';
import { Employee } from '../../../../core/models/employee';
import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
import { todayLocal } from '../../../../shared/utils/date';
import { formatHours, formatYen } from '../../../../shared/utils/number';
import { OfficeContext } from '../../../office/office-context.service';
import { ContractService } from '../../contract.service';
import {
  contractAt,
  contractErrors,
  ContractFormValue,
  contractWarnings,
  emptyContractForm,
  fromContractForm,
  HOURS_UNITS,
  isShortPeriod,
  nextContractForm,
  scheduledWageCandidate,
  toContractForm,
  wageFieldOf,
  weeklyMinutesOf,
} from '../../logic/contract-form-model';

/**
 * 雇用契約の履歴（契約書の束：変わるたびに上に重ねる）
 * 被保険者区分の判定は、事業所の規模などと合わせて後で出す。ここでは事実を入れるだけ
 */
@Component({
  selector: 'app-contract-card',
  imports: [HalfWidthDigits, ReactiveFormsModule, TranslocoPipe],
  templateUrl: './contract-card.html',
  styleUrl: './contract-card.css',
})
export class ContractCard implements OnInit {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(ContractService);
  readonly context = inject(OfficeContext);

  readonly employee = input.required<Employee>();
  /** 保存・削除したことを知らせる */
  readonly changed = output<void>();

  // ===== 選択肢 =====
  readonly employmentTypes = EMPLOYMENT_TYPES;
  readonly payTypes = PAY_TYPES;
  readonly hoursUnits = HOURS_UNITS;
  readonly renewalTypes = RENEWAL_TYPES;
  readonly studentTypes = STUDENT_TYPES;
  readonly dispatchTypes = DISPATCH_TYPES;
  readonly specialEmployments = SPECIAL_EMPLOYMENTS;

  /** 2か月以内の契約か（更新の実績・労使の合意の欄を出す） */
  shortPeriod(): boolean {
    const v = this.form.getRawValue();
    return isShortPeriod(v.from ?? '', v.periodEnd || null);
  }
  readonly yen = formatYen;
  readonly hoursText = formatHours;
  readonly today = todayLocal();

  // ===== 箱 =====
  readonly rows = signal<ContractDoc[]>([]);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);
  /** null は閉じている、'new' は追加、それ以外は編集中の始まる日 */
  readonly editing = signal<'new' | string | null>(null);
  readonly confirmingDelete = signal<string | null>(null);
  /** 同じ始まる日の契約がある → 上書きしてよいかの確認中 */
  readonly confirmingOverwrite = signal(false);
  readonly saving = signal(false);
  /** 「保存」を押したあとだけエラーを見せる */
  readonly submitted = signal(false);
  /** 学生・最低賃金の減額特例・派遣請負・メモを開いているか */
  readonly showMore = signal(false);

  readonly form = this.fb.group(emptyContractForm(''));
  /** フォームの今の値（候補・エラーの計算に使う） */
  private readonly value = signal<ContractFormValue>(this.form.getRawValue());

  readonly errors = computed(() => contractErrors(this.value()));
  readonly warnings = computed(() => contractWarnings(this.value(), this.employee().hireDate));
  readonly wageField = computed(() => wageFieldOf(this.value().payType));
  readonly candidate = computed(() => scheduledWageCandidate(this.value()));
  /** 週以外で入れたとき、週に直した時間を見せる */
  readonly weeklyPreview = computed(() => {
    const v = this.value();
    if (v.hoursUnit === 'week') return null;
    const m = weeklyMinutesOf(v.hoursUnit, v.hours, v.cycleWeeks);
    return m == null ? null : formatHours(m);
  });
  /** 今日に効いている契約（一覧で目立たせる） */
  readonly currentFrom = computed(() => contractAt(this.rows(), this.today)?.from ?? null);

  /** 直前に所定内賃金から写した見込みの報酬月額（手で直したかの判定に使う） */
  private lastAutoCash = '';

  constructor() {
    this.form.valueChanges.subscribe(() => this.value.set(this.form.getRawValue()));
    // 見込みの報酬月額は、空なら所定内賃金を写す（残業の見込み・通勤手当は担当者が足す）
    this.form.controls.scheduledWage.valueChanges.subscribe((v) => {
      const cash = this.form.controls.expectedCash;
      if (!cash.value || cash.value === this.lastAutoCash) cash.setValue(v);
      this.lastAutoCash = v;
    });
    // 始まる日を変えたら、上書きの確認はやり直し
    this.form.controls.from.valueChanges.subscribe(() => this.confirmingOverwrite.set(false));
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
    this.loading.set(true);
    try {
      this.rows.set(await this.api.list(officeId, this.employee().id));
    } catch (err) {
      console.error(err);
      this.errorKey.set('contract.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  // ===== 表示の道具 =====

  /** 欄のエラーの文言（「保存」を押す前は出さない） */
  errorOf(field: keyof ContractFormValue): string | null {
    const e = this.errors()[field];
    return this.submitted() && e ? `contract.error.${e}` : null;
  }

  /** 一覧の「時給・日給」の列 */
  unitWage(r: ContractDoc): string {
    if (r.hourlyWage != null) return `${formatYen(r.hourlyWage)}／h`;
    if (r.dailyWage != null) return `${formatYen(r.dailyWage)}／d`;
    return '—';
  }

  // ===== 追加・編集・削除 =====

  private open(v: ContractFormValue, key: 'new' | string): void {
    this.form.setValue(v, { emitEvent: false });
    this.value.set(v);
    this.lastAutoCash = v.expectedCash === v.scheduledWage ? v.scheduledWage : '';
    this.showMore.set(
      v.student !== 'none' || v.minimumWageReduction || v.dispatch !== 'none' || v.note !== '',
    );
    this.submitted.set(false);
    this.confirmingOverwrite.set(false);
    this.errorKey.set(null);
    this.editing.set(key);
  }

  /** 最初の契約は入社日から。2つ目からは今の契約を写す（変わった所だけ直せばよい） */
  startAdd(): void {
    const latest = this.rows()[0]; // 新しい順
    this.form.controls.from.enable();
    this.open(latest ? nextContractForm(latest, '') : emptyContractForm(this.employee().hireDate), 'new');
  }

  startEdit(row: ContractDoc): void {
    this.open(toContractForm(row), row.from);
    this.form.controls.from.disable(); // 始まる日はドキュメントIDなので変えられない
  }

  cancel(): void {
    this.editing.set(null);
  }

  /** 所定内賃金の候補を入れる */
  useCandidate(): void {
    const c = this.candidate();
    if (c !== null) this.form.controls.scheduledWage.setValue(formatYen(c));
  }

  async save(): Promise<void> {
    this.submitted.set(true);
    const v = this.form.getRawValue();
    const input = fromContractForm(v);
    const officeId = this.officeId;
    if (!input || !officeId) return;

    const isNew = this.editing() === 'new';
    const exists = this.rows().some((r) => r.from === input.from);
    if (isNew && exists && !this.confirmingOverwrite()) {
      this.confirmingOverwrite.set(true);
      return;
    }

    this.saving.set(true);
    this.errorKey.set(null);
    try {
      // 同じ始まる日の行があれば書き換え（作った日時は残す）
      if (isNew && !exists) await this.api.create(officeId, this.employee().id, input);
      else await this.api.update(officeId, this.employee().id, input);
      this.editing.set(null);
      await this.load();
      this.changed.emit();
    } catch (err) {
      console.error(err);
      this.errorKey.set('contract.error.save');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(from: string): Promise<void> {
    const officeId = this.officeId;
    if (!officeId) return;
    this.saving.set(true);
    try {
      await this.api.delete(officeId, this.employee().id, from);
      this.confirmingDelete.set(null);
      await this.load();
      this.changed.emit();
    } catch (err) {
      console.error(err);
      this.errorKey.set('contract.error.delete');
    } finally {
      this.saving.set(false);
    }
  }
}
