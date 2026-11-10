import { Component, computed, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
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
import { ToastService } from '../../../../shared/services/toast.service';
import { premiumOf } from '../../../office/office-settings';
import { EmployeeService } from '../../employee.service';
import { AgreementService } from '../../agreement.service';
import { AgreementDoc } from '../../../../core/models/master';
import { CertificateLike, certificateWarnings, defaultCovers } from '../../logic/agreement';
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
import { EmployeeStep, nextStep, prevStep, stepBlocked, stepsFor, STEP_CONTROLS } from '../../logic/employee-steps';
import {
  countryOptions,
  RESIDENCE_GROUPS,
  RESIDENCE_STATUSES,
  ResidenceGroup,
} from '../../logic/foreign-options';
import { LanguageService } from '../../../../core/i18n/language.service';

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
  // 入社日に15歳未満は雇えない（労働基準法56条。年少者の例外は、このアプリでは扱わない）
  else if (v.birthDate && v.hireDate && v.hireDate < addYears(v.birthDate, 15)) errors['birthTooYoung'] = true;
  if (v.retireDate && v.hireDate && v.retireDate < v.hireDate) errors['retireBeforeHire'] = true;
  for (const k of ['health', 'pension'] as const) {
    const e = v[k];
    if (e.enrolled && !e.acquiredDate) errors[`${k}AcquiredRequired`] = true;
    if (e.acquiredDate && e.lostDate && e.lostDate <= e.acquiredDate) errors[`${k}LostBeforeAcquired`] = true;
  }
  // 口座：1つでも入れたら、銀行・支店・種別・番号・名義を全部（振込に使えない半端な口座を残さない）
  const b = v.bankAccount;
  const bankFilled = [b.bankName, b.branchName, b.accountType, b.accountNumber, b.holderKana].map((x) => !!x?.trim());
  if (bankFilled.some((x) => x) && !bankFilled.every((x) => x)) errors['bankIncomplete'] = true;
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
  accountNumber: 'employee.validation.accountNumber',
  holderKana: 'employee.validation.holderKana',
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
  private readonly agreementsApi = inject(AgreementService);
  private readonly toast = inject(ToastService);
  readonly context = inject(OfficeContext);
  /** 社会保障協定のマスタ（読めなければ空のまま。照らし合わせが出ないだけ） */
  readonly agreements = signal<AgreementDoc[]>([]);
  /** 適用証明書の入力（照らし合わせ用） */
  private readonly cert = signal<CertificateLike | null>(null);
  readonly certAgreement = computed(() => {
    const c = this.cert();
    return c ? (this.agreements().find((a) => a.country === c.country) ?? null) : null;
  });
  // ===== 国籍・在留資格の選択肢 =====
  private readonly language = inject(LanguageService);
  readonly isEn = computed(() => this.language.lang() === 'en');
  readonly countries = computed(() => countryOptions(this.language.lang()));
  readonly residenceGroups = RESIDENCE_GROUPS;

  residenceOf(g: ResidenceGroup) {
    return RESIDENCE_STATUSES.filter((s) => s.group === g);
  }

  /** 前に打ち込んだ、一覧にない国籍・在留資格（選択肢に残して、消えないようにする） */
  unlistedNationality(): string | null {
    const v = this.form.controls.foreign.controls.nationality.value.trim().toUpperCase();
    return v && !this.countries().some((c) => c.code === v) ? v : null;
  }

  unlistedResidence(): string | null {
    const v = this.form.controls.foreign.controls.residenceStatus.value.trim();
    return v && !RESIDENCE_STATUSES.some((s) => s.ja === v) ? v : null;
  }

  /** 適用証明書の国の選択肢：協定のある国（国名の順） */
  readonly agreementOptions = computed(() =>
    [...this.agreements()].sort((a, b) => a.name.localeCompare(b.name, 'ja')),
  );

  /** 前に打ち込んだ、協定の一覧にない国（選択肢に残して、消えないようにする） */
  unlistedCountry(): string | null {
    const c = this.form.controls.foreign.controls.certCountry.value.trim().toUpperCase();
    return c && !this.agreements().some((a) => a.country === c) ? c : null;
  }

  readonly certWarnings = computed(() =>
    this.agreements().length === 0 ? [] : certificateWarnings(this.cert(), this.agreements(), todayLocal()),
  );
  /** 事業所の本人負担の集め方（「事業所の設定のまま」の後ろに出す） */
  readonly officeMethod = computed(() => {
    const o = this.context.current();
    return o ? premiumOf(o).method : 'payroll';
  });

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
        optOutDate: [v.optOutDate],
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
          holderKana: [v.bankAccount.holderKana, [Validators.pattern(PATTERNS.holderKana), Validators.maxLength(100)]],
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

  // ===== 段階式の登録（新規だけ。編集は1ページのまま） =====
  /** 外国籍を選んでいるか（段の並びが変わる） */
  private readonly foreignOn = signal(false);
  readonly steps = computed(() => stepsFor(this.foreignOn()));
  readonly step = signal<EmployeeStep>('basic');

  /** そのまとまりを出すか：編集と確認の段では全部、ほかはその段のまとまりだけ */
  show(s: EmployeeStep): boolean {
    return this.isEdit || this.step() === 'confirm' || this.step() === s;
  }

  /** 次へ：この段の欄だけ確かめる（ほかの段の欄はまだ触っていないので、赤くしない） */
  next(): void {
    const s = this.step();
    if (s !== 'confirm') {
      for (const path of STEP_CONTROLS[s]) this.form.get(path)?.markAllAsTouched();
    }
    if (stepBlocked(s, errorPaths(this.form), Object.keys(this.form.errors ?? {}))) {
      this.errorKey.set('employee.error.stepInvalid');
      setTimeout(() =>
        document.querySelector('.is-invalid, .field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      );
      return;
    }
    this.errorKey.set(null);
    this.goTo(nextStep(this.steps(), s));
  }

  back(): void {
    this.errorKey.set(null);
    this.goTo(prevStep(this.steps(), this.step()));
  }

  /** 段を移る（上の段の印から戻るときも）。画面のいちばん上から見せる */
  goTo(s: EmployeeStep): void {
    this.step.set(s);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** 段の印を押せるか（今より前の段だけ。先の段は「次へ」で確かめてから進む） */
  canGoTo(s: EmployeeStep): boolean {
    return this.steps().indexOf(s) < this.steps().indexOf(this.step());
  }

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
    c.hasForeign.valueChanges.subscribe((v) => this.foreignOn.set(v));
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
    // 適用証明書：国を入れたら、協定の範囲を初期値に入れる。入力が変わるたびに照らし合わせる
    const f = c.foreign.controls;
    f.certCountry.valueChanges.subscribe((country) => {
      const covers = defaultCovers(country.trim().toUpperCase(), this.agreements());
      if (covers && f.certCovers.value !== covers) f.certCovers.setValue(covers);
    });
    c.foreign.valueChanges.subscribe(() => this.syncCert());
    this.agreementsApi.list().then(
      (list) => {
        this.agreements.set(list);
        this.syncCert();
      },
      (err) => console.error(err),
    );
    if (this.isEdit) this.loadForEdit();
  }

  private syncCert(): void {
    const f = this.form.controls.foreign.getRawValue();
    this.cert.set(
      f.hasCertificate && f.certCountry.trim() && f.certFrom
        ? { country: f.certCountry.trim().toUpperCase(), from: f.certFrom, to: f.certTo || null, covers: f.certCovers }
        : null,
    );
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
      const e = await this.employees.getFull(officeId, this.employeeId);
      if (!e) {
        this.errorKey.set('employee.error.notFound');
        return;
      }
      // 保存済みの値を「自動の値」として扱う（入社日・退職日を変えたら追従する）
      this.lastAutoAcquired = e.hireDate;
      this.lastAutoLost = e.retireDate ? addDays(e.retireDate, 1) : '';
      // 読み込みで自動入力が走らないように
      this.form.setValue(toEmployeeForm(e), { emitEvent: false });
      this.syncCert();
    } catch (err) {
      console.error(err);
      this.errorKey.set('employee.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  /** 項目のエラー（触る前・正しいときは null） */
  /** 折りたたみ欄に何か入っていれば、開いたままにする（入れた値が隠れないように） */
  anyFilled(path: string): boolean {
    const has = (x: unknown): boolean =>
      typeof x === 'string' ? x.trim() !== '' : !!x && typeof x === 'object' && Object.values(x).some(has);
    return has(this.form.get(path)?.value);
  }

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
    // 新規は確認の段でだけ保存する（途中の段で Enter を押したら「次へ」と同じ）
    if (!this.isEdit && this.step() !== 'confirm') {
      this.next();
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // 何も起きないように見えないよう、ボタンの横に知らせて、最初の赤い欄まで動かす
      this.errorKey.set('employee.error.invalid');
      console.warn('[employee-form] 直すところ', invalidPaths(this.form));
      setTimeout(() =>
        document.querySelector('.is-invalid, .field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      );
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
      this.toast.show(this.isEdit ? 'common.saved' : 'employee.form.created');
      await this.router.navigate(['/o', officeId, 'employees', id]);
    } catch (err) {
      console.error(err);
      this.errorKey.set('employee.error.save');
    } finally {
      this.submitting.set(false);
    }
  }
}

/** エラーのある欄の場所（'foreign.certFrom' など。まとまり全体のエラーは '(全体)' つき） */
function invalidPaths(c: AbstractControl, path = ''): string[] {
  const out: string[] = [];
  if (c.errors) out.push(`${path || '(全体)'}: ${Object.keys(c.errors).join(',')}`);
  if (c instanceof FormGroup) {
    for (const [k, child] of Object.entries(c.controls)) out.push(...invalidPaths(child, path ? `${path}.${k}` : k));
  }
  return out;
}

/** エラーのある欄の場所だけ（まとまり全体のエラーは除く。段の判断に使う） */
function errorPaths(c: AbstractControl, path = ''): string[] {
  const out: string[] = [];
  if (c instanceof FormGroup) {
    for (const [k, child] of Object.entries(c.controls)) out.push(...errorPaths(child, path ? `${path}.${k}` : k));
  } else if (c.errors && path) {
    out.push(path);
  }
  return out;
}

/** 'YYYY-MM-DD' の n 年後（2/29 生まれは、うるう年でない年は 3/1 として比べる） */
function addYears(date: string, n: number): string {
  const y = Number(date.slice(0, 4)) + n;
  const md = date.slice(5);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return md === '02-29' && !leap ? `${y}-03-01` : `${y}-${md}`;
}
