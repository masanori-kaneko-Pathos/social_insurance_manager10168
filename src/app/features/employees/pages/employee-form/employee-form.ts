import { Component, computed, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  ACCOUNT_TYPES,
  ACQUISITION_TYPES,
  AGREEMENT_COVERS,
  FILING_NAMES,
  LOSS_REASONS,
  NO_ADDRESS_REASONS,
  NO_ROMAN_REASONS,
  RETIRE_REASONS,
  SEXES,
} from '../../../../core/models/employee';
import { addDays, todayLocal } from '../../../../shared/utils/date';
import { toHalfWidth } from '../../../../shared/utils/text';
import { OfficeContext } from '../../../office/office-context.service';
import { EmployeeService } from '../../employee.service';
import {
  emptyEmployeeForm,
  EmployeeFormValue,
  EnrollmentForm,
  fromEmployeeForm,
  isPersonNameComplete,
  isPersonNameFilled,
  PATTERNS,
  PersonNameForm,
  toEmployeeForm,
} from '../../logic/employee-form-model';

import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
const NOT_BLANK = Validators.pattern(/\S/);

/** 全角を半角にしてから形式を見る（空欄は通す） */
function halfPattern(re: RegExp): ValidatorFn {
  return (c: AbstractControl): ValidationErrors | null => {
    const v = String(c.value ?? '').trim();
    return v === '' || re.test(toHalfWidth(v)) ? null : { pattern: true };
  };
}

/** フォーム全体のチェック（日付の前後関係・国籍で変わる必須） */
function wholeForm(g: AbstractControl): ValidationErrors | null {
  const v = g.value as EmployeeFormValue;
  const errors: ValidationErrors = {};
  if (!v.hasForeign) {
    // 日本国籍：氏名と名のフリガナも必須（外国籍は姓だけの国があるので名は任意）
    if (!v.lastName.trim()) errors['lastNameRequired'] = true;
    if (!v.firstName.trim()) errors['firstNameRequired'] = true;
    if (!v.firstNameKana.trim()) errors['firstNameKanaRequired'] = true;
  }
  if (v.birthDate && v.birthDate > todayLocal()) errors['birthFuture'] = true;
  if (v.retireDate && v.hireDate && v.retireDate < v.hireDate) errors['retireBeforeHire'] = true;
  for (const k of ['health', 'pension'] as const) {
    const e = v[k];
    if (e.enrolled && !e.acquiredDate) errors[`${k}AcquiredRequired`] = true;
    if (e.acquiredDate && e.lostDate && e.lostDate <= e.acquiredDate) errors[`${k}LostBeforeAcquired`] = true;
  }
  if (v.hasForeign) {
    const f = v.foreign;
    // ローマ字氏名か、ない理由のどちらか
    if (!f.romanLastName.trim() && !f.noRomanReason) errors['romanRequired'] = true;
    if (!f.romanLastName.trim() && f.noRomanReason === 'other' && !f.noRomanReasonText.trim()) {
      errors['noRomanReasonTextRequired'] = true;
    }
    // 漢字氏名・通称名：書き始めたら姓と姓のフリガナまで
    for (const k of ['kanjiName', 'alias'] as const) {
      if (isPersonNameFilled(f[k]) && !isPersonNameComplete(f[k])) errors[`${k}Incomplete`] = true;
    }
    // 取得届に使う氏名を選んだら、その氏名が要る
    if (f.filingName === 'kanji' && !isPersonNameFilled(f.kanjiName)) errors['filingNameMissing'] = true;
    if (f.filingName === 'alias' && !isPersonNameFilled(f.alias)) errors['filingNameMissing'] = true;
    if (!v.foreign.nationality.trim()) errors['nationalityRequired'] = true;
    if (v.foreign.hasCertificate && (!v.foreign.certCountry.trim() || !v.foreign.certFrom)) {
      errors['certificateRequired'] = true;
    }
    if (v.foreign.certFrom && v.foreign.certTo && v.foreign.certTo < v.foreign.certFrom) {
      errors['certificateOrder'] = true;
    }
  }
  return Object.keys(errors).length ? errors : null;
}

/** 形式のエラーの文言（項目のパスの最後の名前 → 翻訳キー） */
const PATTERN_KEYS: Record<string, string> = {
  lastNameKana: 'employee.validation.kana',
  firstNameKana: 'employee.validation.kana',
  lastKana: 'employee.validation.kana',
  firstKana: 'employee.validation.kana',
  romanLastName: 'employee.validation.roman',
  romanFirstName: 'employee.validation.roman',
  romanMiddleName: 'employee.validation.roman',
  phone: 'employee.validation.phone',
  postalCode: 'employee.validation.postalCode',
  basicPensionNumber: 'employee.validation.basicPensionNumber',
  accountNumber: 'employee.validation.digits',
  email: 'employee.validation.email',
  nationality: 'employee.validation.country',
  certCountry: 'employee.validation.country',
  residenceCardNumber: 'employee.validation.residenceCard',
  workPermitHours: 'employee.validation.hours',
};

@Component({
  selector: 'app-employee-form',
  imports: [HalfWidthDigits, ReactiveFormsModule, RouterLink, TranslocoPipe],
  templateUrl: './employee-form.html',
  styleUrl: './employee-form.css',
})
export class EmployeeForm {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly employees = inject(EmployeeService);
  readonly context = inject(OfficeContext);

  readonly employeeId = this.route.snapshot.paramMap.get('employeeId');
  readonly isEdit = this.employeeId !== null;

  // ===== 選択肢 =====
  readonly sexes = SEXES;
  readonly retireReasons = RETIRE_REASONS;
  readonly lossReasons = LOSS_REASONS;
  readonly acquisitionTypes = ACQUISITION_TYPES;
  readonly accountTypes = ACCOUNT_TYPES;
  readonly noAddressReasons = NO_ADDRESS_REASONS;
  readonly agreementCovers = AGREEMENT_COVERS;
  readonly noRomanReasons = NO_ROMAN_REASONS;
  readonly filingNames = FILING_NAMES;
  readonly personNameKinds = ['kanjiName', 'alias'] as const;
  readonly personNameParts = ['last', 'first', 'lastKana', 'firstKana'] as const;

  /** 外国籍を選んでいるか（氏名の欄と「外国人の情報」の表示が変わる） */
  isForeign(): boolean {
    return this.form.controls.hasForeign.value;
  }
  readonly collectionMethods = ['payroll', 'cash'] as const;

  private enrollmentGroup(e: EnrollmentForm) {
    return this.fb.group({
      enrolled: [e.enrolled],
      acquiredDate: [e.acquiredDate],
      lostDate: [e.lostDate],
      lossReason: [e.lossReason],
    });
  }

  private personNameGroup(n: PersonNameForm) {
    return this.fb.group({
      last: [n.last, [Validators.maxLength(50)]],
      first: [n.first, [Validators.maxLength(50)]],
      lastKana: [n.lastKana, [Validators.pattern(PATTERNS.kana), Validators.maxLength(50)]],
      firstKana: [n.firstKana, [Validators.pattern(PATTERNS.kana), Validators.maxLength(50)]],
    });
  }

  private build(v: EmployeeFormValue) {
    const f = v.foreign;
    return this.fb.group(
      {
        employeeNumber: [v.employeeNumber, [Validators.maxLength(20)]],
        hasForeign: [v.hasForeign],
        // 氏名・名のフリガナの必須は国籍で変わるので、フォーム全体のチェックで見る
        lastName: [v.lastName, [Validators.maxLength(50)]],
        firstName: [v.firstName, [Validators.maxLength(50)]],
        lastNameKana: [v.lastNameKana, [Validators.required, NOT_BLANK, Validators.pattern(PATTERNS.kana), Validators.maxLength(50)]],
        firstNameKana: [v.firstNameKana, [Validators.pattern(PATTERNS.kana), Validators.maxLength(50)]],
        sortByKana: [v.sortByKana],
        birthDate: [v.birthDate, [Validators.required]],
        sex: [v.sex],
        hireDate: [v.hireDate, [Validators.required]],
        retireDate: [v.retireDate],
        retireReason: [v.retireReason],
        health: this.enrollmentGroup(v.health),
        pension: this.enrollmentGroup(v.pension),
        acquisitionType: [v.acquisitionType],
        multipleOffices: [v.multipleOffices],
        rehired: [v.rehired],
        needsConfirmationCard: [v.needsConfirmationCard],
        optInDate: [v.optInDate],
        insuredNumber: [v.insuredNumber, [Validators.maxLength(10)]],
        basicPensionNumber: [v.basicPensionNumber, [halfPattern(PATTERNS.basicPensionNumber)]],
        contact: this.fb.group({
          postalCode: [v.contact.postalCode, [halfPattern(PATTERNS.postalCode)]],
          address: [v.contact.address, [Validators.maxLength(200)]],
          phone: [v.contact.phone, [halfPattern(PATTERNS.phone)]],
          email: [v.contact.email, [halfPattern(PATTERNS.email), Validators.maxLength(254)]],
        }),
        commute: this.fb.group({
          method: [v.commute.method, [Validators.maxLength(50)]],
          route: [v.commute.route, [Validators.maxLength(200)]],
        }),
        bankAccount: this.fb.group({
          bankName: [v.bankAccount.bankName, [Validators.maxLength(50)]],
          branchName: [v.bankAccount.branchName, [Validators.maxLength(50)]],
          accountType: [v.bankAccount.accountType],
          accountNumber: [v.bankAccount.accountNumber, [halfPattern(PATTERNS.accountNumber)]],
          holderKana: [v.bankAccount.holderKana, [Validators.maxLength(100)]],
        }),
        collectionMethod: [v.collectionMethod],
        foreign: this.fb.group({
          romanLastName: [f.romanLastName, [halfPattern(PATTERNS.roman), Validators.maxLength(50)]],
          romanFirstName: [f.romanFirstName, [halfPattern(PATTERNS.roman), Validators.maxLength(50)]],
          romanMiddleName: [f.romanMiddleName, [halfPattern(PATTERNS.roman), Validators.maxLength(50)]],
          noRomanReason: [f.noRomanReason],
          noRomanReasonText: [f.noRomanReasonText, [Validators.maxLength(100)]],
          kanjiName: this.personNameGroup(f.kanjiName),
          alias: this.personNameGroup(f.alias),
          filingName: [f.filingName],
          residentRegistered: [f.residentRegistered],
          needsRomanNameFiling: [f.needsRomanNameFiling],
          nationality: [f.nationality, [halfPattern(PATTERNS.country)]],
          residenceCardNumber: [f.residenceCardNumber, [halfPattern(PATTERNS.residenceCard)]],
          residenceStatus: [f.residenceStatus, [Validators.maxLength(50)]],
          residenceExpiry: [f.residenceExpiry],
          workPermit: [f.workPermit],
          workPermitHours: [f.workPermitHours, [halfPattern(PATTERNS.hours)]],
          noAddressReason: [f.noAddressReason],
          hasCertificate: [f.hasCertificate],
          certCountry: [f.certCountry, [halfPattern(PATTERNS.country)]],
          certFrom: [f.certFrom],
          certTo: [f.certTo],
          certCovers: [f.certCovers],
        }),
      },
      { validators: wholeForm },
    );
  }

  readonly form = this.build(emptyEmployeeForm());

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
    const c = this.form.controls;
    c.hireDate.valueChanges.subscribe((hire) => this.syncAcquired(hire));
    c.retireDate.valueChanges.subscribe((retire) => this.syncLost(retire ? addDays(retire, 1) : ''));
    // 退職の理由が「死亡」なら、喪失の原因も「死亡」に（空か「退職等」のときだけ。手で選んだものは変えない）
    c.retireReason.valueChanges.subscribe((reason) => {
      for (const g of [c.health, c.pension]) {
        const lr = g.controls.lossReason;
        if (lr.value === '' || lr.value === 'retire' || lr.value === 'death') {
          if (g.controls.lostDate.value) lr.setValue(reason === 'death' ? 'death' : 'retire');
        }
      }
    });
    // 住民登録がない人は個人番号がない → ローマ字氏名届が要る（候補として入れる。外すこともできる）
    c.foreign.controls.residentRegistered.valueChanges.subscribe((registered) => {
      if (!registered) c.foreign.controls.needsRomanNameFiling.setValue(true);
    });
    if (this.isEdit) this.loadForEdit();
  }

  private syncAcquired(value: string): void {
    for (const g of [this.form.controls.health, this.form.controls.pension]) {
      const c = g.controls.acquiredDate;
      if (!c.value || c.value === this.lastAutoAcquired) c.setValue(value);
    }
    this.lastAutoAcquired = value;
  }

  /** 退職日から喪失日を入れる。喪失の原因が空なら「退職等」を候補として入れる */
  private syncLost(value: string): void {
    const reason = this.form.controls.retireReason.value === 'death' ? 'death' : 'retire';
    for (const g of [this.form.controls.health, this.form.controls.pension]) {
      const c = g.controls.lostDate;
      if (!c.value || c.value === this.lastAutoLost) c.setValue(value);
      const lr = g.controls.lossReason;
      if (value && lr.value === '') lr.setValue(reason);
      if (!value && (lr.value === 'retire' || lr.value === 'death')) lr.setValue('');
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
      // 読み込みで自動入力が走らないように
      this.form.setValue(toEmployeeForm(e), { emitEvent: false });
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
      const last = path.split('.').pop() ?? '';
      return PATTERN_KEYS[last] ?? 'employee.validation.required';
    }
    return null;
  }

  /** フォーム全体のエラー（日付の前後関係・外国人の必須） */
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
    const input = fromEmployeeForm(this.form.getRawValue());

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
