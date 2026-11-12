import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { map } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { UserProfileService } from '../../../../core/auth/user-profile.service';
import { LanguageService } from '../../../../core/i18n/language.service';
import { INDUSTRIES } from '../../../../core/master/industries';
import { PREFECTURES } from '../../../../core/master/prefectures';
import {
  HealthInsurer,
  HealthInsurerType,
  InsurerPeriod,
  Office,
  OfficeInput,
  PayrollSettings,
} from '../../../../core/models/office';
import { CollectionMethod, HealthRounding } from '../../../../core/models/premium';
import { PostalCodeService } from '../../../../shared/services/postal-code.service';
import { corporateNumberValidator } from '../../../../shared/validators/corporate-number';
import { OfficeService } from '../../office.service';
import { OfficeContext } from '../../office-context.service';
import {
  DEFAULT_PAYROLL,
  DEFAULT_PREMIUM,
  FROM_THE_START,
  insurerHistoryOf,
  kumiaiRun,
  payrollOf,
  premiumOf,
  samePeriod,
  spanOf,
  withInsurerChange,
} from '../../office-settings';
import { RateDialog, RateDialogTarget } from '../../../rates/components/rate-dialog/rate-dialog';
import { ToastService } from '../../../../shared/services/toast.service';


import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
import { CriteriaDoc } from '../../../../core/models/master';
import { todayLocal, toYearMonth } from '../../../../shared/utils/date';
import { parseNat } from '../../../../shared/utils/number';
import { FilingTaskInput } from '../../../../core/models/filing-task';
import { hasOfficeChanges, OfficeChanges, officeChanges } from '../../logic/office-changes';
import { DepartmentCard } from '../../components/department-card/department-card';
import { ContractService } from '../../../employees/contract.service';
import { EmployeeService } from '../../../employees/employee.service';
import {
  countHeadcount,
  criteriaAt,
  HeadcountTarget,
  WorkSchedule,
} from '../../../employees/logic/coverage';
import { CriteriaService } from '../../criteria.service';
import {
  CoverageFormValue,
  CoverageWarning,
  coverageErrors,
  coverageWarnings,
  fromCoverageForm,
  MONTHS_OF_YEAR,
  SpecificChoice,
  SPECIFIC_CHOICES,
  STANDARD_HOURS_CANDIDATE,
  StandardHoursUnit,
  standardWeeklyMinutes,
  toCoverageForm,
  toggleMonth,
} from '../../logic/office-form-model';
/** 法人番号を入れたら法人名も必須 */
function corporateNameRequired(g: AbstractControl): ValidationErrors | null {
  const num = (g.get('corporateNumber')?.value ?? '').trim();
  const name = (g.get('corporateName')?.value ?? '').trim();
  return num && !name ? { corporateNameRequired: true } : null;
}

/** 組合健保なら組合名も必須 */
function kumiaiNameRequired(g: AbstractControl): ValidationErrors | null {
  const type = g.get('insurerType')?.value;
  const name = (g.get('kumiaiName')?.value ?? '').trim();
  return type === 'kumiai' && !name ? { kumiaiNameRequired: true } : null;
}

const NOT_BLANK = Validators.pattern(/\S/);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

type Field =
  | 'name'
  | 'corporateName'
  | 'corporateNumber'
  | 'ownerName'
  | 'industry'
  | 'postalCode'
  | 'prefecture'
  | 'address'
  | 'kumiaiName'
  | 'officeSymbol'
  | 'officeNumber'
  | 'employeeCount'
  | 'changeFrom';

const PATTERN_ERROR: Partial<Record<Field, string>> = {
  postalCode: 'office.validation.postalCode',
  officeNumber: 'office.validation.digits',
};

const emptyToNull = (v: string) => (v.trim() ? v.trim() : null);

@Component({
  selector: 'app-office-form',
  imports: [DepartmentCard, HalfWidthDigits, ReactiveFormsModule, RouterLink, TranslocoPipe, RateDialog],
  templateUrl: './office-form.html',
  styleUrl: './office-form.css',
})
export class OfficeForm {
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly profiles = inject(UserProfileService);
  private readonly offices = inject(OfficeService);
  private readonly postal = inject(PostalCodeService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly language = inject(LanguageService);
  private readonly criteria = inject(CriteriaService);
  private readonly employees = inject(EmployeeService);
  private readonly contracts = inject(ContractService);
  readonly context = inject(OfficeContext);

  readonly prefectures = PREFECTURES;
  readonly industries = INDUSTRIES;
  readonly days = Array.from({ length: 31 }, (_, i) => i + 1); // 31 は「月末」と表示する
  readonly lang = computed(() => (this.language.lang() === 'en' ? 'en' : 'ja'));

  /** 編集（/o/:officeId/settings）か、新規登録（/offices/new）か */
  readonly isEdit = this.route.snapshot.data['mode'] === 'edit';
  /** 編集で、admin でなければ読み取り専用 */
  readonly readOnly = this.isEdit && !this.context.isAdmin();

  readonly form = this.fb.nonNullable.group(
    {
      name: ['', [Validators.required, NOT_BLANK, Validators.maxLength(100)]],
      nameEn: ['', [Validators.maxLength(100)]],
      groupName: ['', [Validators.maxLength(40)]],
      corporateName: ['', [Validators.maxLength(100)]],
      corporateNumber: ['', [corporateNumberValidator]],
      ownerName: ['', [Validators.required, NOT_BLANK, Validators.maxLength(50)]],
      industry: [''],
      postalCode: ['', [Validators.pattern(/^\d{3}-?\d{4}$/)]],
      prefecture: ['', [Validators.required]],
      address: ['', [Validators.required, NOT_BLANK, Validators.maxLength(200)]],
      insurerType: ['kyokai' as HealthInsurerType],
      kumiaiName: ['', [Validators.maxLength(100)]],
      officeSymbol: ['', [Validators.maxLength(20)]],
      officeNumber: ['', [Validators.pattern(/^\d{1,10}$/)]],
      employeeCount: this.fb.control<number | null>(null, [
        Validators.min(0),
        Validators.max(1000000),
      ]),
      // 給与と保険料の計算
      closingDay: [DEFAULT_PAYROLL.closingDay],
      payMonth: [DEFAULT_PAYROLL.payMonth as PayrollSettings['payMonth']],
      payDay: [DEFAULT_PAYROLL.payDay],
      deduction: [DEFAULT_PAYROLL.deduction as PayrollSettings['deduction']],
      method: [DEFAULT_PREMIUM.method as CollectionMethod],
      healthRounding: [DEFAULT_PREMIUM.healthRounding as HealthRounding],
      // 編集で保険者・都道府県を変えたときの「何月分から」
      changeFrom: [''],
      // 社会保険の適用・賞与の支払予定月・現物（形は logic/office-form-model.ts の CoverageFormValue）
      coverage: this.fb.nonNullable.group({
        hoursUnit: ['week' as StandardHoursUnit],
        hours: [''],
        monthlyDays: [''],
        specific: ['none' as SpecificChoice],
        specificSince: [''],
        insuredCount: [''],
        pensionFund: [false],
        bonusMonths: this.fb.nonNullable.control<number[]>([]),
        housing: [false],
        meals: [false],
      }),
    },
    { validators: [corporateNameRequired, kumiaiNameRequired] },
  );

  /** フォームの値（変更の検知に使う。読み取り専用で無効にしても値が消えないよう getRawValue を使う） */
  private readonly value = toSignal(
    this.form.valueChanges.pipe(map(() => this.form.getRawValue())),
    {
      initialValue: this.form.getRawValue(),
    },
  );
  readonly insurerType = computed(() => this.value().insurerType);

  /** 編集中の事業所（新規登録なら null） */
  readonly office = computed<Office | null>(() => (this.isEdit ? this.context.current() : null));

  // ===== 届が要る変更（名称・所在地・事業主・賞与の月・現物など。11/12） =====
  /** 変わった日（期限はこの日を1日目に5日。初期値は今日） */
  readonly changeFactDate = signal(todayLocal());
  /** 保存すると届出の宿題になる変更（新規登録・変更なしなら null） */
  readonly pendingChanges = computed<OfficeChanges | null>(() => {
    const o = this.office();
    if (!o) return null;
    const v = this.value();
    const p = this.periodFromForm();
    const c = officeChanges(
      {
        name: o.name,
        postalCode: o.postalCode,
        address: o.address,
        prefecture: o.prefecture,
        ownerName: o.ownerName,
        corporateNumber: o.corporateNumber,
        healthInsurer: o.healthInsurer,
        bonusMonths: o.bonusMonths ?? [],
        inKind: o.inKind ?? { housing: false, meals: false },
      },
      {
        name: v.name ?? '',
        postalCode: (v.postalCode ?? '').replace('-', '') || null,
        address: v.address ?? '',
        prefecture: p.prefecture,
        ownerName: v.ownerName ?? '',
        corporateNumber: (v.corporateNumber ?? '').trim() || null,
        healthInsurer: p.healthInsurer,
        bonusMonths: v.coverage?.bonusMonths ?? [],
        inKind: { housing: !!v.coverage?.housing, meals: !!v.coverage?.meals },
      },
    );
    return hasOfficeChanges(c) ? c : null;
  });

  /** 変更 → 届出の宿題 */
  private tasksOf(c: OfficeChanges | null): FilingTaskInput[] {
    if (!c) return [];
    const factDate = this.changeFactDate() || todayLocal();
    const tasks: FilingTaskInput[] = [];
    if (c.nameAddress.length > 0) {
      tasks.push({ kind: 'officeNameAddress', employeeId: null, factDate, fields: [...c.nameAddress] });
    }
    if (c.relation.length > 0) {
      tasks.push({ kind: 'officeRelation', employeeId: null, factDate, fields: [...c.relation] });
    }
    return tasks;
  }
  readonly history = computed<InsurerPeriod[]>(() => {
    const o = this.office();
    return o ? insurerHistoryOf(o) : [];
  });

  /** 料率の窓（開いていなければ null） */
  readonly rateTarget = signal<RateDialogTarget | null>(null);

  /** 健康保険の欄の近道：保存済みの今の保険者が組合健保で、フォームで保険者を変えていないとき */
  readonly showKumiaiShortcut = computed(
    () => this.office()?.healthInsurer.type === 'kumiai' && !this.insurerChanged(),
  );

  /** 編集で、保険者か都道府県が変わったか */
  readonly insurerChanged = computed(() => {
    const o = this.office();
    if (!o) return false;
    return !samePeriod(this.periodFromForm(), {
      prefecture: o.prefecture,
      healthInsurer: o.healthInsurer,
    });
  });

  /** 協会けんぽ → 組合健保 に切り替えようとしているか */
  readonly switchingToKumiai = computed(
    () =>
      this.insurerChanged() &&
      this.insurerType() === 'kumiai' &&
      this.office()?.healthInsurer.type !== 'kumiai',
  );

  // ===== 社会保険の適用 =====
  readonly specificChoices = SPECIFIC_CHOICES;
  readonly months = MONTHS_OF_YEAR;
  readonly standardCandidate = STANDARD_HOURS_CANDIDATE;
  /** 人数を数える月・基準を選ぶ月（今月） */
  readonly thisMonth = toYearMonth(todayLocal());

  readonly coverageValue = computed<CoverageFormValue>(() => this.value().coverage);
  readonly coverageErrs = computed(() => coverageErrors(this.coverageValue()));

  /** 加入の基準（masterCriteria）と、今月の基準 */
  readonly criteriaRows = signal<CriteriaDoc[] | null>(null);
  readonly criteriaNow = computed(() => criteriaAt(this.criteriaRows() ?? [], this.thisMonth));

  /** 画面に入っている所定（読めなければ null）。数えた人数は、所定を直すとすぐ変わる */
  private readonly formStandard = computed<WorkSchedule | null>(() => {
    const v = this.coverageValue();
    const weekly = standardWeeklyMinutes(v);
    const days = parseNat(v.monthlyDays);
    return weekly && days ? { weeklyMinutes: weekly, monthlyDays: days } : null;
  });

  /** 「数える」で読んだ従業員と契約（null ＝ まだ数えていない） */
  readonly people = signal<HeadcountTarget[] | null>(null);
  readonly counting = signal<'idle' | 'loading' | 'failed'>('idle');
  readonly headcount = computed(() => {
    const p = this.people();
    return p ? countHeadcount(p, this.formStandard(), this.thisMonth) : null;
  });

  /** 注意：人数は、手で入れた人数があればそれ、なければ数えた人数 */
  readonly coverageWarns = computed(() => {
    const typed = parseNat(this.coverageValue().insuredCount);
    return coverageWarnings(this.coverageValue(), {
      headcount: typed ?? this.headcount()?.counted ?? null,
      sizeMin: this.criteriaNow()?.sizeMin ?? null,
    });
  });

  readonly myOffices = signal<Office[]>([]);
  readonly copied = signal(false);
  readonly postalStatus = signal<'idle' | 'loading' | 'notFound' | 'failed'>('idle');
  readonly submitting = signal(false);
  readonly saved = signal(false);
  readonly errorKey = signal<string | null>(null);

  constructor() {
    this.criteria
      .list()
      .then((rows) => this.criteriaRows.set(rows))
      .catch((err) => {
        console.error(err);
        this.criteriaRows.set([]);
      });
    if (this.isEdit) {
      const o = this.context.current();
      if (o) this.fillFrom(o);
      if (this.readOnly) this.form.disable();
    } else {
      const uid = this.auth.user()?.uid;
      if (uid) {
        this.offices
          .listMine(uid)
          .then((list) => this.myOffices.set(list))
          .catch((err) => console.error(err));
      }
    }
  }

  /** 編集：保存済みの事業所の値をフォームに入れる（設定がない古いデータは初期値） */
  private fillFrom(o: Office): void {
    const payroll = payrollOf(o);
    const premium = premiumOf(o);
    this.form.setValue({
      name: o.name,
      nameEn: o.nameEn ?? '',
      groupName: o.groupName ?? '',
      corporateName: o.corporateName ?? '',
      corporateNumber: o.corporateNumber ?? '',
      ownerName: o.ownerName,
      industry: o.industry ?? '',
      postalCode: o.postalCode ?? '',
      prefecture: o.prefecture,
      address: o.address,
      insurerType: o.healthInsurer.type,
      kumiaiName: o.healthInsurer.kumiaiName ?? '',
      officeSymbol: o.officeSymbol ?? '',
      officeNumber: o.officeNumber ?? '',
      employeeCount: o.employeeCount,
      closingDay: payroll.closingDay,
      payMonth: payroll.payMonth,
      payDay: payroll.payDay,
      deduction: payroll.deduction,
      method: premium.method,
      healthRounding: premium.healthRounding,
      changeFrom: '',
      coverage: toCoverageForm(o),
    });
  }

  /** フォームの保険者・都道府県 */
  private periodFromForm(): { prefecture: string; healthInsurer: HealthInsurer } {
    const v = this.value();
    const type = v.insurerType ?? 'kyokai';
    return {
      prefecture: v.prefecture ?? '',
      healthInsurer: { type, kumiaiName: type === 'kumiai' ? (v.kumiaiName ?? '').trim() : null },
    };
  }

  /** 項目ごとのエラーの翻訳キー（触る前・正しいときは null） */
  errorOf(name: Field): string | null {
    const c = this.form.controls[name];
    if (!c.touched) return null;
    if (name === 'corporateName' && this.form.hasError('corporateNameRequired')) {
      return 'office.validation.corporateNameRequired';
    }
    if (name === 'kumiaiName' && this.form.hasError('kumiaiNameRequired')) {
      return 'office.validation.required';
    }
    if (name === 'changeFrom') {
      const month = this.form.controls.changeFrom.value;
      return this.insurerChanged() && !MONTH.test(month) ? 'office.validation.changeFrom' : null;
    }
    if (!c.errors) return null;
    if (c.hasError('required')) return 'office.validation.required';
    if (c.hasError('maxlength')) return 'office.validation.tooLong';
    if (c.hasError('corporateNumber')) return 'office.validation.corporateNumber';
    if (c.hasError('min') || c.hasError('max')) return 'office.validation.count';
    if (c.hasError('pattern')) return PATTERN_ERROR[name] ?? 'office.validation.required';
    return null;
  }

  async lookupPostal(): Promise<void> {
    const c = this.form.controls.postalCode;
    c.markAsTouched();
    const code = c.value.replace('-', '');
    if (!/^\d{7}$/.test(code)) return;

    this.postalStatus.set('loading');
    try {
      const r = await this.postal.lookup(code);
      if (!r) {
        this.postalStatus.set('notFound');
        return;
      }
      this.form.patchValue({ prefecture: r.prefCode, address: r.city + r.town });
      this.postalStatus.set('idle');
      document.getElementById('address')?.focus(); // 続けて番地を入力できるように
    } catch (err) {
      console.error(err);
      this.postalStatus.set('failed');
    }
  }

  copyFrom(officeId: string): void {
    const o = this.myOffices().find((x) => x.id === officeId);
    if (!o) return;
    const payroll = payrollOf(o);
    const premium = premiumOf(o);
    this.form.patchValue({
      groupName: o.groupName ?? '',
      corporateName: o.corporateName ?? '',
      corporateNumber: o.corporateNumber ?? '',
      ownerName: o.ownerName,
      insurerType: o.healthInsurer.type,
      kumiaiName: o.healthInsurer.kumiaiName ?? '',
      industry: o.industry ?? '',
      closingDay: payroll.closingDay,
      payMonth: payroll.payMonth,
      payDay: payroll.payDay,
      deduction: payroll.deduction,
      method: premium.method,
      healthRounding: premium.healthRounding,
    });
    // 所定と特定適用事業所は法人単位で同じことが多いので写す（人数・基金・賞与・現物は事業所ごと）
    const cov = toCoverageForm(o);
    this.form.controls.coverage.patchValue({
      hoursUnit: cov.hoursUnit,
      hours: cov.hours,
      monthlyDays: cov.monthlyDays,
      specific: cov.specific,
      specificSince: cov.specificSince,
    });
    this.copied.set(true);
  }

  // ===== 社会保険の適用 =====

  /** 適用の欄のエラーの翻訳キー（触る前・正しいときは null） */
  coverageErrorOf(name: keyof CoverageFormValue): string | null {
    if (!this.form.controls.coverage.controls[name].touched) return null;
    const e = this.coverageErrs()[name];
    return e ? `office.coverage.error.${e}` : null;
  }

  hasWarning(w: CoverageWarning): boolean {
    return this.coverageWarns().includes(w);
  }

  /** 候補ボタン：週 40:00 */
  fillStandardHours(): void {
    this.form.controls.coverage.patchValue({ hoursUnit: 'week', hours: this.standardCandidate });
    this.form.controls.coverage.controls.hours.markAsTouched();
  }

  toggleBonusMonth(month: number): void {
    const c = this.form.controls.coverage.controls.bonusMonths;
    c.setValue(toggleMonth(c.value, month));
    c.markAsDirty();
  }

  /**
   * 企業規模の人数を数える（この事業所の従業員と、1人ずつの契約を読む）
   * 人数が多いと読む回数が増える（課金）ので、開いたときではなく、押したときだけ読む
   */
  async countPeople(): Promise<void> {
    const o = this.office();
    if (!o) return;
    this.counting.set('loading');
    try {
      const list = await this.employees.list(o.id);
      const people = await Promise.all(
        list.map(async (e) => ({
          birthDate: e.birthDate,
          hireDate: e.hireDate,
          retireDate: e.retireDate,
          contracts: await this.contracts.list(o.id, e.id),
        })),
      );
      this.people.set(people);
      this.counting.set('idle');
    } catch (err) {
      console.error(err);
      this.counting.set('failed');
    }
  }

  /** 履歴の月の表示（「最初から」は文字で） */
  isStart(from: string): boolean {
    return from === FROM_THE_START;
  }

  prefectureName(code: string): string {
    return this.prefectures.find((p) => p.code === code)?.[this.lang()] ?? code;
  }

  /** 履歴の行（index）の料率を窓で開く。組合健保は同じ組合が続く期間をまとめて扱う */
  openRates(index: number): void {
    const o = this.office();
    if (!o) return;
    const history = insurerHistoryOf(o);
    const row = history[index];
    if (!row) return;
    const range = kumiaiRun(history, index) ?? spanOf(history, index);
    this.rateTarget.set({
      officeId: o.id,
      prefecture: row.prefecture,
      prefectureName: this.prefectureName(row.prefecture),
      insurer: row.healthInsurer,
      range,
      startKnown: range.from !== FROM_THE_START,
    });
  }

  /** 近道：今の期間（履歴の最後の行）を開く */
  openCurrentRates(): void {
    this.openRates(this.history().length - 1);
  }

  async submit(): Promise<void> {
    if (this.readOnly) return;
    const changeFrom = this.form.controls.changeFrom;
    const coverage = fromCoverageForm(this.form.controls.coverage.getRawValue());
    if (
      this.form.invalid ||
      !coverage ||
      (this.insurerChanged() && !MONTH.test(changeFrom.value))
    ) {
      this.form.markAllAsTouched();
      return;
    }
    const uid = this.auth.user()?.uid;
    if (!uid) return;

    this.submitting.set(true);
    this.saved.set(false);
    this.errorKey.set(null);

    const v = this.form.getRawValue();
    const period = this.periodFromForm();
    const base = {
      name: v.name.trim(),
      nameEn: emptyToNull(v.nameEn),
      groupName: emptyToNull(v.groupName),
      corporateName: emptyToNull(v.corporateName),
      corporateNumber: emptyToNull(v.corporateNumber),
      ownerName: v.ownerName.trim(),
      postalCode: v.postalCode ? v.postalCode.replace('-', '') : null,
      prefecture: period.prefecture,
      address: v.address.trim(),
      healthInsurer: period.healthInsurer,
      officeSymbol: emptyToNull(v.officeSymbol),
      officeNumber: emptyToNull(v.officeNumber),
      industry: v.industry || null,
      employeeCount: v.employeeCount ?? null,
      payroll: {
        closingDay: Number(v.closingDay),
        payMonth: v.payMonth,
        payDay: Number(v.payDay),
        deduction: v.deduction,
      },
      premium: { method: v.method, healthRounding: v.healthRounding },
      ...coverage,
    };

    try {
      const office = this.office();
      if (office) {
        // 編集：保険者・都道府県が変わったら「何月分から」を履歴に足す（最新の行は今の値と同じになる）
        const history = this.insurerChanged()
          ? withInsurerChange(insurerHistoryOf(office), { from: changeFrom.value, ...period })
          : insurerHistoryOf(office);
        const input: OfficeInput = { ...base, insurerHistory: history };
        await this.offices.update(office.id, input, this.tasksOf(this.pendingChanges()));
        this.changeFactDate.set(todayLocal());
        const fresh = await this.offices.get(office.id);
        if (fresh) {
          this.context.setCurrent(fresh); // 保険料の画面などに、新しい設定をすぐ反映
          this.fillFrom(fresh);
        }
        await this.context.refresh(uid); // 切り替えの一覧の名前なども最新に
        this.form.markAsUntouched();
        this.saved.set(true);
        this.toast.show('common.saved');
      } else {
        // 新規登録：履歴は「最初から今の値」の1行
        const input: OfficeInput = {
          ...base,
          insurerHistory: [{ from: FROM_THE_START, ...period }],
        };
        const officeId = await this.offices.create(uid, input);
        await this.profiles.load(uid); // currentOfficeId を最新にする
        await this.context.refresh(uid); // 切り替えの一覧にすぐ反映
        await this.router.navigateByUrl(`/o/${officeId}`);
      }
    } catch (err) {
      console.error(err);
      this.errorKey.set('office.error.save');
    } finally {
      this.submitting.set(false);
    }
  }
}
