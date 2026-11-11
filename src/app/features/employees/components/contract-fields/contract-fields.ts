import { Component, computed, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  DISPATCH_TYPES,
  EMPLOYMENT_TYPES,
  PAY_TYPES,
  RENEWAL_TYPES,
  SPECIAL_EMPLOYMENTS,
  STUDENT_TYPES,
} from '../../../../core/models/contract';
import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
import { formatHours, formatYen } from '../../../../shared/utils/number';
import {
  contractErrors,
  ContractFormValue,
  contractWarnings,
  HOURS_UNITS,
  isShortPeriod,
  scheduledWageCandidate,
  wageFieldOf,
  weeklyMinutesOf,
} from '../../logic/contract-form-model';

/** 雇用契約のフォーム（FormBuilder.nonNullable.group(emptyContractForm(...)) の形） */
export type ContractForm = FormGroup<{ [K in keyof ContractFormValue]: FormControl<ContractFormValue[K]> }>;

/**
 * 雇用契約の入力欄（契約のカードと、従業員の登録の「雇用契約」の段で同じものを使う）
 * フォームは呼ぶ側が持つ。ここは欄・候補・エラーの見せ方だけ。保存は呼ぶ側
 */
@Component({
  selector: 'app-contract-fields',
  imports: [HalfWidthDigits, ReactiveFormsModule, TranslocoPipe],
  templateUrl: './contract-fields.html',
  styleUrl: '../contract-card/contract-card.css',
})
export class ContractFields implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  readonly form = input.required<ContractForm>();
  /** 「保存」（登録なら「次へ」）を押したあとだけエラーを見せる */
  readonly submitted = input(false);
  /** 入社日（それより前に始まる契約に注意を出す） */
  readonly hireDate = input('');
  /** 今の契約を写して始めた（「変わった所だけ直してください」と出す） */
  readonly copied = input(false);

  // ===== 選択肢 =====
  readonly employmentTypes = EMPLOYMENT_TYPES;
  readonly payTypes = PAY_TYPES;
  readonly hoursUnits = HOURS_UNITS;
  readonly renewalTypes = RENEWAL_TYPES;
  readonly studentTypes = STUDENT_TYPES;
  readonly dispatchTypes = DISPATCH_TYPES;
  readonly specialEmployments = SPECIAL_EMPLOYMENTS;
  readonly yen = formatYen;

  /** フォームの今の値（候補・エラーの計算に使う） */
  private readonly value = signal<ContractFormValue | null>(null);
  /** 学生・最低賃金の減額特例・派遣請負・メモを開いているか */
  readonly showMore = signal(false);

  readonly errors = computed(() => {
    const v = this.value();
    return v ? contractErrors(v) : {};
  });
  readonly warnings = computed(() => {
    const v = this.value();
    return v ? contractWarnings(v, this.hireDate()) : [];
  });
  readonly wageField = computed(() => {
    const v = this.value();
    return v ? wageFieldOf(v.payType) : null;
  });
  readonly candidate = computed(() => {
    const v = this.value();
    return v ? scheduledWageCandidate(v) : null;
  });
  /** 週以外で入れたとき、週に直した時間を見せる */
  readonly weeklyPreview = computed(() => {
    const v = this.value();
    if (!v || v.hoursUnit === 'week') return null;
    const m = weeklyMinutesOf(v.hoursUnit, v.hours, v.cycleWeeks);
    return m == null ? null : formatHours(m);
  });
  /** 2か月以内の契約か（更新の実績・労使の合意の欄を出す） */
  readonly shortPeriod = computed(() => {
    const v = this.value();
    return !!v && isShortPeriod(v.from ?? '', v.periodEnd || null);
  });

  /** 直前に所定内賃金から写した見込みの報酬月額（手で直したかの判定に使う） */
  private lastAutoCash = '';

  ngOnInit(): void {
    const form = this.form();
    const v = form.getRawValue();
    this.value.set(v);
    this.lastAutoCash = v.expectedCash === v.scheduledWage ? v.scheduledWage : '';
    this.showMore.set(v.student !== 'none' || v.minimumWageReduction || v.dispatch !== 'none' || v.note !== '');
    form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.value.set(form.getRawValue()));
    // 見込みの報酬月額は、空なら所定内賃金を写す（残業の見込み・通勤手当は担当者が足す）
    form.controls.scheduledWage.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((s) => {
      const cash = form.controls.expectedCash;
      if (!cash.value || cash.value === this.lastAutoCash) cash.setValue(s);
      this.lastAutoCash = s;
    });
  }

  /** 欄のエラーの文言（「保存」を押す前は出さない） */
  errorOf(field: keyof ContractFormValue): string | null {
    const e = (this.errors() as Partial<Record<keyof ContractFormValue, string>>)[field];
    return this.submitted() && e ? `contract.error.${e}` : null;
  }

  /** 所定内賃金の候補を入れる */
  useCandidate(): void {
    const c = this.candidate();
    if (c !== null) this.form().controls.scheduledWage.setValue(formatYen(c));
  }
}
