import { Component, inject, signal, computed } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { EmployeeInput } from '../../../../core/models/employee';
import { todayLocal } from '../../../../shared/utils/date';
import { OfficeContext } from '../../../office/office-context.service';
import { EmployeeService } from '../../employee.service';
import { addDays } from '../../logic/coverage';

const KANA = /^[ァ-ヶー・\s　]+$/;
const NOT_BLANK = Validators.pattern(/\S/);

/** 日付の前後関係のチェック（フォーム全体） */
function dateOrder(g: AbstractControl): ValidationErrors | null {
  const v = g.value;
  const errors: ValidationErrors = {};
  if (v.birthDate && v.birthDate > todayLocal()) errors['birthFuture'] = true;
  if (v.retireDate && v.hireDate && v.retireDate < v.hireDate) errors['retireBeforeHire'] = true;
  for (const k of ['health', 'pension'] as const) {
    const e = v[k];
    if (e.enrolled && !e.acquiredDate) errors[`${k}AcquiredRequired`] = true;
    if (e.acquiredDate && e.lostDate && e.lostDate <= e.acquiredDate) errors[`${k}LostBeforeAcquired`] = true;
  }
  return Object.keys(errors).length ? errors : null;
}

const toNull = (v: string) => (v.trim() ? v.trim() : null);

@Component({
  selector: 'app-employee-form',
  imports: [ReactiveFormsModule, RouterLink, TranslocoPipe],
  templateUrl: './employee-form.html',
  styleUrl: './employee-form.css',
})
export class EmployeeForm {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly employees = inject(EmployeeService);
  readonly context = inject(OfficeContext);

  readonly employeeId = this.route.snapshot.paramMap.get('employeeId');
  readonly isEdit = this.employeeId !== null;

  private enrollmentGroup() {
    return this.fb.nonNullable.group({
      enrolled: [true],
      acquiredDate: [''],
      lostDate: [''],
    });
  }

  readonly form = this.fb.nonNullable.group(
    {
      employeeNumber: ['', [Validators.maxLength(20)]],
      lastName: ['', [Validators.required, NOT_BLANK, Validators.maxLength(50)]],
      firstName: ['', [Validators.required, NOT_BLANK, Validators.maxLength(50)]],
      lastNameKana: ['', [Validators.required, Validators.pattern(KANA), Validators.maxLength(50)]],
      firstNameKana: ['', [Validators.required, Validators.pattern(KANA), Validators.maxLength(50)]],
      birthDate: ['', [Validators.required]],
      hireDate: ['', [Validators.required]],
      retireDate: [''],
      health: this.enrollmentGroup(),
      pension: this.enrollmentGroup(),
    },
    { validators: dateOrder },
  );

  readonly loading = signal(this.isEdit);
  readonly submitting = signal(false);
  readonly errorKey = signal<string | null>(null);
  /** 「戻る」の行き先：編集なら詳細、新規なら一覧 */
  readonly backLink = computed(() => {
    const officeId = this.context.current()?.id;
    return this.isEdit
      ? ['/o', officeId, 'employees', this.employeeId]
      : ['/o', officeId, 'employees'];
  });

  /** 直前の自動入力の値（手で直したかの判定に使う） */
  private lastAutoAcquired = '';
  private lastAutoLost = '';

  constructor() {
    this.form.controls.hireDate.valueChanges.subscribe((hire) => this.syncAcquired(hire));
    this.form.controls.retireDate.valueChanges.subscribe((retire) =>
      this.syncLost(retire ? addDays(retire, 1) : ''),
    );
    if (this.isEdit) this.loadForEdit();
  }

  private syncAcquired(value: string): void {
    for (const g of [this.form.controls.health, this.form.controls.pension]) {
      const c = g.controls.acquiredDate;
      if (!c.value || c.value === this.lastAutoAcquired) c.setValue(value);
    }
    this.lastAutoAcquired = value;
  }

  private syncLost(value: string): void {
    for (const g of [this.form.controls.health, this.form.controls.pension]) {
      const c = g.controls.lostDate;
      if (!c.value || c.value === this.lastAutoLost) c.setValue(value);
    }
    this.lastAutoLost = value;
  }

  private async loadForEdit(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || !this.employeeId) return;
    try {
      const e = await this.employees.get(officeId, this.employeeId);
      if (!e) {
        this.errorKey.set('employee.error.notFound');
        return;
      }
      // 保存済みの値を「自動の値」として扱う（入社日・退職日を変えたら追従する）
      this.lastAutoAcquired = e.hireDate;
      this.lastAutoLost = e.retireDate ? addDays(e.retireDate, 1) : '';
      this.form.setValue(
        {
          employeeNumber: e.employeeNumber ?? '',
          lastName: e.lastName,
          firstName: e.firstName,
          lastNameKana: e.lastNameKana,
          firstNameKana: e.firstNameKana,
          birthDate: e.birthDate,
          hireDate: e.hireDate,
          retireDate: e.retireDate ?? '',
          health: {
            enrolled: e.health.enrolled,
            acquiredDate: e.health.acquiredDate ?? '',
            lostDate: e.health.lostDate ?? '',
          },
          pension: {
            enrolled: e.pension.enrolled,
            acquiredDate: e.pension.acquiredDate ?? '',
            lostDate: e.pension.lostDate ?? '',
          },
        },
        { emitEvent: false }, // 読み込みで自動入力が走らないように
      );
    } catch (err) {
      console.error(err);
      this.errorKey.set('employee.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  /** 項目のエラー（触る前・正しいときは null） */
  errorOf(path: string): string | null {
    const c = this.form.get(path);
    if (!c || !c.touched || !c.errors) return null;
    if (c.hasError('required')) return 'employee.validation.required';
    if (c.hasError('maxlength')) return 'employee.validation.tooLong';
    if (c.hasError('pattern')) {
      return path.endsWith('Kana') ? 'employee.validation.kana' : 'employee.validation.required';
    }
    return null;
  }

  /** フォーム全体のエラー（日付の前後関係） */
  groupError(key: string, path: string): boolean {
    return !!this.form.get(path)?.touched && this.form.hasError(key);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const officeId = this.context.current()?.id;
    if (!officeId) return;

    this.submitting.set(true);
    this.errorKey.set(null);

    const v = this.form.getRawValue();
    const enrollment = (e: typeof v.health) => ({
      enrolled: e.enrolled,
      acquiredDate: toNull(e.acquiredDate),
      lostDate: toNull(e.lostDate),
    });
    const input: EmployeeInput = {
      employeeNumber: toNull(v.employeeNumber),
      lastName: v.lastName.trim(),
      firstName: v.firstName.trim(),
      lastNameKana: v.lastNameKana.trim(),
      firstNameKana: v.firstNameKana.trim(),
      birthDate: v.birthDate,
      hireDate: v.hireDate,
      retireDate: toNull(v.retireDate),
      health: enrollment(v.health),
      pension: enrollment(v.pension),
    };

    try {
      let id: string;
      if (this.isEdit && this.employeeId) {
        await this.employees.update(officeId, this.employeeId, input);
        id = this.employeeId;
      } else {
        id = await this.employees.create(officeId, input);
      }
      await this.router.navigate(['/o', officeId, 'employees', id]);
    } catch (err) {
      console.error(err);
      this.errorKey.set('employee.error.save');
    } finally {
      this.submitting.set(false);
    }
  }
}