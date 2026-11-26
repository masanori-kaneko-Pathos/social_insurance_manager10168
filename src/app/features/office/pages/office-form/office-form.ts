import { afterNextRender, Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
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
  PayGroup,
  Department,
} from '../../../../core/models/office';
import { AGREEMENT_ROUNDINGS, AgreementRounding, CollectionMethod, HealthRounding } from '../../../../core/models/premium';
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
  withDeductionChange,
  premiumOf,
  samePeriod,
  withInsurerDetails,
  spanOf,
  withInsurerChange,
} from '../../office-settings';
import { RateDialog, RateDialogTarget } from '../../../rates/components/rate-dialog/rate-dialog';
import { RateService } from '../../../rates/rate.service';
import { formatRateInput, parseSplit } from '../../../rates/logic/rate-format';
import { RateFileImport } from '../../../rates/components/rate-file-import/rate-file-import';
import { KumiaiSharePick } from '../../../rates/components/kumiai-share-pick/kumiai-share-pick';
import { kumiaiChoicesOf, shareTargets } from '../../../rates/logic/kumiai-share';
import { insurerNumberError, normalizeInsurerNumber } from '../../logic/insurer-number';
import { findRates, guessFill } from '../../../rates/logic/rate-pdf';
import { ImportFileError, MAX_FILE_BYTES } from '../../../../shared/import/parse';
import { EnterNext } from '../../../../shared/directives/enter-next';
import type { KumiaiRateInput, MonthRange } from '../../../../core/models/rates';
import { ToastService } from '../../../../shared/services/toast.service';


import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
import { CriteriaDoc } from '../../../../core/models/master';
import { shiftMonth, todayLocal, toYearMonth } from '../../../../shared/utils/date';
import { parseNat } from '../../../../shared/utils/number';
import { FilingTaskInput } from '../../../../core/models/filing-task';
import { hasOfficeChanges, OfficeChanges, officeChanges } from '../../logic/office-changes';
import { DepartmentCard } from '../../components/department-card/department-card';
import { PasswordGate } from '../../../my-number/components/password-gate/password-gate';
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
  earliestSpecificMonth,
  fromCoverageForm,
  MONTHS_OF_YEAR,
  SpecificChoice,
  SPECIFIC_CHOICES,
  StandardHoursUnit,
  standardWeeklyMinutes,
  toCoverageForm,
  toggleMonth,
} from '../../logic/office-form-model';
import { adjustmentOfficeStatus } from '../../../premiums/logic/adjustment-office';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { watchUnsaved } from '../../../../shared/services/unsaved-changes';
import { MAX_PAY_GROUPS, newPayGroupId, payGroupErrors } from '../../logic/pay-group';
import { BackLink } from '../../../../shared/components/back-link/back-link';
import { SettingsTabs } from '../../components/settings-tabs/settings-tabs';
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
  | 'insurerNumber'
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
  imports: [BackLink, SettingsTabs, DepartmentCard, EnterNext, HalfWidthDigits, PasswordGate, ReactiveFormsModule, RouterLink, TranslocoPipe, RateDialog, RateFileImport, KumiaiSharePick],
  templateUrl: './office-form.html',
  styleUrl: './office-form.css',
})
export class OfficeForm {
  readonly agreementRoundings = AGREEMENT_ROUNDINGS;
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
  private readonly rates = inject(RateService);
  private readonly transloco = inject(TranslocoService);
  readonly context = inject(OfficeContext);

  readonly prefectures = PREFECTURES;
  readonly industries = INDUSTRIES;
  readonly days = Array.from({ length: 31 }, (_, i) => i + 1); // 31 は「月末」と表示する
  readonly lang = computed(() => (this.language.lang() === 'en' ? 'en' : 'ja'));

  /** 編集（/o/:officeId/settings）か、新規登録（/offices/new）か */
  readonly isEdit = this.route.snapshot.data['mode'] === 'edit';
  /** 編集で、admin でなければ読み取り専用 */
  readonly readOnly = this.isEdit && !this.context.isAdmin();

  /** 保存していない入力があれば、画面を離れる前に確かめる（11/17） */
  private readonly unsaved = watchUnsaved(() => this.form.dirty || this.firstRates.dirty || this.ratesLoaded());
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
      insurerNumber: [''],
      /** 特定被保険者の制度（組合の規約。11/26） */
      specialInsured: [false],
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
      // 控除の時期を変えるとき：何月分の保険料から変えるか（編集だけ。11/20）
      deductionFrom: [''],
      method: [DEFAULT_PREMIUM.method as CollectionMethod],
      healthRounding: [DEFAULT_PREMIUM.healthRounding as HealthRounding],
      // 労使協定（特約）の端数処理（'' ＝ 法律どおり。11/16）
      agreementRounding: ['' as AgreementRounding | ''],
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
      // 保険料調整制度（編集のときだけ。使う・使い始めた月。11/16）
      adjustmentOn: [false],
      adjustmentSince: [''],
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

  // ===== 組合の最初の料率（11/17）：組合の名前と同じときに入れられるように =====
  // 新規登録で組合を選んだとき・編集で組合に切り替えるときに出す。空なら入れない（あとで料率の窓から）
  // 単位は %（‰ や CSV・PDF で入れるときは、保存したあと履歴の「料率を見る」から）
  readonly firstRates = this.fb.nonNullable.group({
    from: [''],
    health: this.fb.nonNullable.group({ total: [''], employee: [''], employer: [''] }),
    care: this.fb.nonNullable.group({ total: [''], employee: [''], employer: [''] }),
    childSupport: this.fb.nonNullable.group({ total: ['0.230'], employee: ['0.115'], employer: ['0.115'] }),
  });
  readonly firstRateKinds = ['health', 'care', 'childSupport'] as const;
  readonly firstRateErrors = signal<Partial<Record<'from' | 'health' | 'care' | 'childSupport', string>>>({});
  readonly firstRatesFrom = signal('');

  /** 最初の料率の欄を出すか：組合を選んでいて、新規登録か、編集で保険者を変えるとき */
  readonly showFirstRates = computed(
    () => this.insurerType() === 'kumiai' && (!this.isEdit || this.insurerChanged()),
  );

  // ----- ファイルから（共通の部品 app-rate-file-import。保存のとき、ファイルの行か、手で入れた分を書く。11/17） -----
  private readonly rateImport = viewChild(RateFileImport);

  // ----- 同じ組合のほかの事業所（組合の名前の候補と、最初の料率を写す。11/26） -----
  /** 自分が所属しているほかの事業所（新規登録では「既存の事業所をコピー」と同じ一覧） */
  private readonly otherOffices = computed(() => (this.myOffices().length ? this.myOffices() : this.context.mine()));
  /** 組合の名前の候補（一字違いで別の組合にならないように。保険者番号が分かれば一緒に入れる） */
  readonly kumiaiChoices = computed(() => kumiaiChoicesOf(this.otherOffices()));
  /** 入れた組合（保険者番号があれば番号で、なければ名前で）と同じ組合のほかの事業所 */
  readonly shareFrom = computed(() => {
    const v = this.value();
    return shareTargets(
      this.otherOffices(),
      { kumiaiName: v.kumiaiName, insurerNumber: insurerNumberError(v.insurerNumber) ? null : normalizeInsurerNumber(v.insurerNumber) || null },
      this.office()?.id ?? null,
    );
  });

  // ----- 組合の保険者番号（11/26。台帳 R107） -----
  /** 必須か：新しく組合で登録するとき・組合に切り替える（組合を変える）とき。今ある組合の事業所は空でも保存できる（To-do で知らせる） */
  readonly insurerNumberRequired = computed(
    () => this.insurerType() === 'kumiai' && (!this.isEdit || this.insurerChanged()),
  );
  /** 保険者番号のエラーの翻訳キー（正しい・空でよいときは null） */
  readonly insurerNumberProblem = computed<string | null>(() => {
    if (this.insurerType() !== 'kumiai') return null;
    const raw = this.value().insurerNumber;
    const err = insurerNumberError(raw);
    if (err) return `office.validation.insurerNumber.${err}`;
    if (!normalizeInsurerNumber(raw) && this.insurerNumberRequired()) return 'office.validation.required';
    return null;
  });

  /** 候補から組合の名前を選んだら、分かっている保険者番号も入れる（番号の欄が空のときだけ） */
  private fillNumberFromChoice(name: string): void {
    const c = this.form.controls.insurerNumber;
    if (normalizeInsurerNumber(c.value)) return;
    const hit = this.kumiaiChoices().find((x) => x.name === name.trim());
    if (hit?.insurerNumber) c.setValue(hit.insurerNumber);
  }

  onSharePicked(e: { rates: KumiaiRateInput[]; label: string }): void {
    this.rateImport()?.loadRates(e.rates, this.transloco.translate('rateImport.share.label', { name: e.label }));
  }
  /** ファイルを読み込んでいる間は、手で入れる欄をしまう */
  readonly ratesLoaded = computed(() => !!this.rateImport()?.loaded());
  readonly pdfError = signal<string | null>(null);
  readonly pdfFilled = signal<number | null>(null); // PDF：欄に入れた数

  /** ファイルの行の期間：新規登録は最初から、編集で切り替えるときは切り替える月から（前の月はエラーにする） */
  readonly ratesRange = computed<MonthRange>(() => {
    const f = this.firstRatesFrom();
    return { from: this.isEdit && MONTH.test(f) ? f : FROM_THE_START, to: null };
  });

  /** PDF：通知の値を、手で入れる欄に入れる（空の欄だけ） */
  async readRatesPdf(file: File): Promise<void> {
    this.pdfError.set(null);
    this.pdfFilled.set(null);
    try {
      if (file.size > MAX_FILE_BYTES) throw new ImportFileError('tooBig');
      const { readPdfLines } = await import('../../../../shared/import/pdf');
      const cands = findRates(await readPdfLines(await file.arrayBuffer()));
      let filled = 0;
      for (const [key, rate] of Object.entries(guessFill(cands))) {
        const [kind, field] = key.split('.') as ['health' | 'care' | 'childSupport', 'total' | 'employee' | 'employer'];
        const c = this.firstRates.controls[kind]?.controls[field];
        if (c && c.value.trim() === '' && rate !== undefined) {
          c.setValue(formatRateInput(rate, 'percent'));
          c.markAsDirty();
          filled++;
        }
      }
      this.pdfFilled.set(filled);
      if (!filled) this.pdfError.set('rateDialog.pdf.none');
    } catch (err) {
      console.error(err);
      this.pdfError.set(err instanceof ImportFileError ? `importMap.error.${err.code}` : 'rateDialog.csv.readError');
    }
  }

  clearRatesFile(): void {
    this.rateImport()?.clear();
    this.pdfError.set(null);
    this.pdfFilled.set(null);
  }

  /** 保存のときに書く料率：ファイルを読み込んでいればファイルの行、なければ手で入れた分 */
  private ratesToWrite(manual: KumiaiRateInput | null): KumiaiRateInput[] {
    const imp = this.rateImport();
    if (this.ratesLoaded() && imp) return imp.toSave().map((x) => x.input).sort((a, b) => a.from.localeCompare(b.from));
    return manual ? [manual] : [];
  }

  /** ファイルにエラーの行が残っていて、除いて取り込むにもしていない */
  private ratesBlocked(): boolean {
    return this.showFirstRates() && this.ratesLoaded() && !!this.rateImport()?.blocked();
  }

  /** 支援金は2026年4月分から（それより前から入れるときは0にするので、欄を出さない） */
  readonly firstRatesNeedChildSupport = computed(() => {
    const f = this.firstRatesFrom();
    return !/^\d{4}-\d{2}$/.test(f) || f >= '2026-04';
  });

  /**
   * 最初の料率を読む。何も入れていなければ null（入れない）。間違いがあれば errors に入れて false
   * 編集で切り替えるときは、何月分からが切り替えの月より前だとだめ
   */
  private readFirstRates(): KumiaiRateInput | null | false {
    if (!this.showFirstRates() || this.ratesLoaded()) {
      this.firstRateErrors.set({});
      return null;
    }
    const raw = this.firstRates.getRawValue();
    // 編集で切り替えるときは、何月分からは「変更を適用する月」と同じ（欄を2つにしない）
    const v = this.isEdit ? { ...raw, from: this.form.controls.changeFrom.value } : raw;
    const blank = (g: { total: string; employee: string; employer: string }) => !g.total.trim() && !g.employee.trim() && !g.employer.trim();
    if ((this.isEdit || !v.from.trim()) && blank(v.health) && blank(v.care)) {
      this.firstRateErrors.set({});
      return null;
    }
    const errors: Partial<Record<'from' | 'health' | 'care' | 'childSupport', string>> = {};
    if (!MONTH.test(v.from)) errors.from = 'office.firstRates.error.from';
    const health = parseSplit(v.health, 'percent');
    const care = parseSplit(v.care, 'percent');
    const needCs = !MONTH.test(v.from) || v.from >= '2026-04';
    const cs = needCs ? parseSplit(v.childSupport, 'percent') : ({ ok: true, split: { employee: 0, employer: 0 } } as const);
    if (!health.ok) errors.health = `rateDialog.error.${health.error}`;
    if (!care.ok) errors.care = `rateDialog.error.${care.error}`;
    if (!cs.ok) errors.childSupport = `rateDialog.error.${cs.error}`;
    this.firstRateErrors.set(errors);
    if (Object.keys(errors).length > 0 || !health.ok || !care.ok || !cs.ok) return false;
    return { from: v.from, health: health.split, care: care.split, childSupport: cs.split };
  }

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
  /** 人数を数える月・基準を選ぶ月（今月） */
  readonly thisMonth = toYearMonth(todayLocal());
  /** 控除の時期を、保存済みの設定から変えようとしているか（編集だけ。11/20） */
  readonly deductionChanged = computed(() => {
    const o = this.office();
    return !!o && this.value().deduction !== payrollOf(o).deduction;
  });
  readonly deductionTo = computed(() => this.value().deduction);
  /** 何月分から変えるか：今月より前は選べない（過去の控除の記録を書き換えないため。11/20） */
  readonly deductionFromInvalid = computed(() => {
    if (!this.deductionChanged()) return false;
    const from = this.value().deductionFrom;
    return !MONTH.test(from) || from < this.thisMonth;
  });

  readonly coverageValue = computed<CoverageFormValue>(() => this.value().coverage);
  readonly coverageErrs = computed(() => coverageErrors(this.coverageValue()));

  // ===== 保険料調整制度（11/16） =====
  /** 今の「特定適用事業所」の選び方から、使える事業所か・申出の期限 */
  readonly adjustmentStatus = computed(() => {
    const c = this.coverageValue();
    return adjustmentOfficeStatus(
      c.specific === 'none' ? null : { since: c.specificSince || null, voluntary: c.specific === 'voluntary' },
    );
  });
  readonly adjustmentOnNow = computed(() => this.value().adjustmentOn);
  /** 使うにしたのに、使い始めた月が入っていない */
  readonly adjustmentSinceMissing = computed(() => {
    const v = this.value();
    return v.adjustmentOn && !MONTH.test(v.adjustmentSince);
  });

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
      criteria: this.criteriaRows() ?? undefined,
    });
  });

  /** 今の人数で基準を超えていた最初の時期（「該当した月」の注意に出す。11/19） */
  readonly earliestSpecific = computed(() => {
    const n = parseNat(this.coverageValue().insuredCount) ?? this.headcount()?.counted ?? null;
    return n === null ? null : earliestSpecificMonth(n, this.criteriaRows() ?? []);
  });

  readonly myOffices = signal<Office[]>([]);
  /** コピーした事業所の名前（していなければ null） */
  readonly copied = signal<string | null>(null);
  /** 「既存の事業所をコピー」の選ぶ欄 */
  readonly copyOpen = signal(false);

  /**
   * 目次。part ＝ 大きな区切り（「事業所の設定」「社会保険に関する設定」）、sub ＝ その中の欄
   * 「目次」の見出しは出さず、2つの区切りを同じ大きさで並べる（11/16）
   * はじめの登録でも出す（保険者・所在地の履歴と削除は、編集の画面にしかないので出さない。11/16）
   */
  readonly toc = computed(() => {
    const items: { id: string; key: string; sub?: boolean; part?: boolean }[] = [
      { id: 'sec-top', key: this.isEdit ? 'office.form.titleEdit' : 'office.form.titleNew', part: true },
      { id: 'sec-basic', key: 'office.section.basic', sub: true },
      { id: 'sec-filing', key: 'office.section.filing', sub: true },
      { id: 'sec-departments', key: 'office.department.title', sub: true },
      { id: 'sec-location', key: 'office.section.location', sub: true },
      { id: 'sec-insurance', key: 'office.part.insurance', part: true },
      { id: 'sec-insurer', key: 'office.section.insurer', sub: true },
      ...(this.isEdit ? [{ id: 'sec-history', key: 'office.section.history', sub: true }] : []),
      { id: 'sec-coverage', key: 'office.section.coverage', sub: true },
      { id: 'sec-payroll', key: 'office.section.payroll', sub: true },
    ];
    // 届が要る変更があるとき（保存すると To-do に届出が出る）。保存の前に見落とさないように目次にも出す（11/20）
    if (!this.readOnly && this.pendingChanges()) items.push({ id: 'sec-change', key: 'office.change.title', sub: true });
    if (this.isEdit && this.isOwner()) items.push({ id: 'sec-delete', key: 'office.delete.title' });
    return items;
  });

  /** 目次から、その欄へなめらかに動かす（URL の # は変えない） */
  jump(event: Event, id: string): void {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ===== 給与の支払区分（既定のほかの区分。編集のときだけ。「保存する」で一緒に保存する。11/24） =====
  readonly payGroups = signal<PayGroup[]>([]);
  readonly payGroupErrs = computed(() => payGroupErrors(this.payGroups(), this.transloco.translate('payGroup.defaultName')));
  readonly maxPayGroups = MAX_PAY_GROUPS;

  addPayGroup(): void {
    const v = this.value();
    this.payGroups.update((list) => [
      ...list,
      {
        id: newPayGroupId(list),
        name: '',
        // 初期値は既定の区分の決まり（違う所だけ変えてもらう）
        payroll: { closingDay: v.closingDay, payDay: v.payDay, payMonth: v.payMonth, deduction: v.deduction },
      },
    ]);
    this.form.markAsDirty();
  }

  setPayGroup(i: number, patch: Partial<Omit<PayGroup, 'payroll'>> & { payroll?: Partial<PayGroup['payroll']> }): void {
    this.payGroups.update((list) =>
      list.map((g, k) => (k === i ? { ...g, ...patch, payroll: { ...g.payroll, ...(patch.payroll ?? {}) } } : g)),
    );
    this.form.markAsDirty();
  }

  removePayGroup(i: number): void {
    if (!window.confirm(this.transloco.translate('payGroup.confirmRemove', { name: this.payGroups()[i]?.name ?? '' }))) return;
    this.payGroups.update((list) => list.filter((_, k) => k !== i));
    this.form.markAsDirty();
  }

  /** 部署（フォームと一緒に保存する。11/13 に事業所のフォームの一部にした） */
  readonly departments = signal<Department[]>([]);
  /** 読み込んだときの部署（変わったときだけ書く） */
  private savedDepartments: Department[] = [];

  // ===== チェックを入れたときだけ開く欄（任意の項目。中身があれば初めから開く） =====
  readonly openNameEn = signal(false);
  readonly openGroup = signal(false);
  readonly openInKind = signal(false);
  // 新規登録では最初から開いておく（適用通知書を見ながら、基本情報と続けて入れられるように。11/13）
  readonly openFiling = signal(!this.isEdit);

  // ===== 事業所の削除（代表だけ。名前を打ち込み、パスワードを入れ直してから。11/12） =====
  readonly isOwner = computed(() => {
    const o = this.office();
    const uid = this.auth.user()?.uid;
    if (!o || !uid) return false;
    return (o.ownerUid && o.memberUids.includes(o.ownerUid) ? o.ownerUid : o.memberUids[0]) === uid;
  });
  readonly deleteOpen = signal(false);
  readonly deleteName = signal('');
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);
  readonly deleteNameOk = computed(() => this.deleteName().trim() === (this.office()?.name ?? '').trim());

  async deleteOffice(): Promise<void> {
    const o = this.office();
    const uid = this.auth.user()?.uid;
    if (!o || !uid || !this.deleteNameOk() || this.deleting()) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    try {
      await this.offices.deleteOffice(o.id, this.deleteName().trim());
      await this.profiles.load(uid);
      await this.context.refresh(uid);
      this.toast.show('office.delete.done');
      this.unsaved.release();
      await this.router.navigateByUrl('/');
    } catch (err) {
      console.error(err);
      const r = (err as { details?: { reason?: string } })?.details?.reason;
      this.deleteError.set(`office.delete.error.${r ?? 'unknown'}`);
    } finally {
      this.deleting.set(false);
    }
  }

  /** 「登録する」を押して、足りない項目があった（下の帯にも件数を出す） */
  readonly submitTried = signal(false);
  readonly postalStatus = signal<'idle' | 'loading' | 'notFound' | 'failed'>('idle');
  readonly submitting = signal(false);
  readonly saved = signal(false);
  readonly errorKey = signal<string | null>(null);

  constructor() {
    // 組合の最初の料率：何月分からを見て支援金の欄を出し分ける。編集で切り替えるときは、切り替える月を初めに入れておく
    this.firstRates.controls.from.valueChanges.subscribe((v) => this.firstRatesFrom.set(v));
    this.form.controls.kumiaiName.valueChanges.subscribe((v) => this.fillNumberFromChoice(v ?? ''));
    this.form.controls.changeFrom.valueChanges.subscribe((v) => {
      if (this.isEdit) this.firstRatesFrom.set(v);
    });
    this.criteria
      .list()
      .then((rows) => this.criteriaRows.set(rows))
      .catch((err) => {
        console.error(err);
        this.criteriaRows.set([]);
      });
    // 新規登録：人数が基準以上なら、特定適用事業所の初期値を「該当する」に（人が触っていなければ）
    effect(() => {
      const n = this.suggestSpecific();
      untracked(() => {
        const c = this.form.controls.coverage.controls.specific;
        if (!this.isEdit && n !== null && c.pristine) {
          c.setValue('applied');
          // 該当した年月は通知書で決まる。空なら今月を仮に入れる（ヒントで直すよう知らせる）
          const since = this.form.controls.coverage.controls.specificSince;
          if (!since.value) since.setValue(this.thisMonth);
        }
      });
    });
    if (this.isEdit) {
      const o = this.context.current();
      if (o) this.fillFrom(o);
      if (this.readOnly) this.form.disable();
      // ほかのページから「#bonus-months」などの場所を指定して開いたら、そこまで送る（11/20）
      const fragment = this.route.snapshot.fragment;
      if (fragment) {
        afterNextRender(() => document.getElementById(fragment)?.scrollIntoView({ block: 'start' }));
      }
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
    this.departments.set(o.departments ?? []);
    this.savedDepartments = o.departments ?? [];
    this.payGroups.set((o.payGroups ?? []).map((g) => ({ ...g, payroll: { ...g.payroll } })));
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
      insurerNumber: o.healthInsurer.insurerNumber ?? '',
      specialInsured: o.healthInsurer.specialInsured === true,
      officeSymbol: o.officeSymbol ?? '',
      officeNumber: o.officeNumber ?? '',
      employeeCount: o.employeeCount,
      closingDay: payroll.closingDay,
      payMonth: payroll.payMonth,
      payDay: payroll.payDay,
      deduction: payroll.deduction,
      // 控除の時期を変えるときの初期値：来月分から（11/20）
      deductionFrom: shiftMonth(this.thisMonth, 1),
      method: premium.method,
      healthRounding: premium.healthRounding,
      agreementRounding: premium.agreementRounding ?? '',
      changeFrom: '',
      coverage: toCoverageForm(o),
      adjustmentOn: !!o.premiumAdjustment?.since,
      adjustmentSince: o.premiumAdjustment?.since ?? '',
    });
    this.openNameEn.set(!!o.nameEn);
    this.openGroup.set(!!o.groupName);
    this.openInKind.set(!!o.inKind?.housing || !!o.inKind?.meals);
    this.openFiling.set(!!o.officeSymbol || !!o.officeNumber || o.employeeCount != null);
  }

  /** 現物の欄を閉じたら、チェックも外す（閉じた欄の値を黙って保存しない） */
  toggleInKind(): void {
    const open = !this.openInKind();
    this.openInKind.set(open);
    if (!open) this.form.controls.coverage.patchValue({ housing: false, meals: false });
  }

  /** フォームの保険者・都道府県 */
  private periodFromForm(): { prefecture: string; healthInsurer: HealthInsurer } {
    const v = this.value();
    const type = v.insurerType ?? 'kyokai';
    return {
      prefecture: v.prefecture ?? '',
      healthInsurer:
        type === 'kumiai'
          ? {
              type,
              kumiaiName: (v.kumiaiName ?? '').trim(),
              insurerNumber: normalizeInsurerNumber(v.insurerNumber) || null,
              // 採用しているときだけ書く（前の文書と同じ形を保ち、保険者の履歴の比べ方を変えない）
              ...(v.specialInsured ? { specialInsured: true } : {}),
            }
          : { type, kumiaiName: null },
    };
  }

  /** 項目ごとのエラーの翻訳キー（触る前・正しいときは null） */
  errorOf(name: Field): string | null {
    const c = this.form.controls[name];
    if (!c.touched) return null;
    if (name === 'corporateName' && this.form.hasError('corporateNameRequired')) {
      return 'office.validation.corporateNameRequired';
    }
    if (name === 'insurerNumber') return this.insurerNumberProblem();
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
      insurerNumber: o.healthInsurer.insurerNumber ?? '',
      specialInsured: o.healthInsurer.specialInsured === true,
      industry: o.industry ?? '',
      closingDay: payroll.closingDay,
      payMonth: payroll.payMonth,
      payDay: payroll.payDay,
      deduction: payroll.deduction,
      method: premium.method,
      healthRounding: premium.healthRounding,
      agreementRounding: premium.agreementRounding ?? '',
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
    this.openGroup.set(!!o.groupName);
    this.copied.set(o.name);
    this.copyOpen.set(false);
  }

  // ===== 社会保険の適用 =====

  /** 適用の欄のエラーの翻訳キー（触る前・正しいときは null） */
  coverageErrorOf(name: keyof CoverageFormValue): string | null {
    if (!this.form.controls.coverage.controls[name].touched) return null;
    // 新しく登録するときは、所定労働時間と月の所定労働日数が必須（4分の3基準の物差し。取り込みでも使う）
    if (this.standardMissing().includes(name)) return 'office.validation.required';
    const e = this.coverageErrs()[name];
    return e ? `office.coverage.error.${e}` : null;
  }

  /** 新規登録で空の所定の欄 */
  readonly standardMissing = computed<(keyof CoverageFormValue)[]>(() => {
    if (this.isEdit) return [];
    const v = this.coverageValue();
    return (['hours', 'monthlyDays'] as const).filter((k) => !v[k].trim());
  });

  /** 人数が基準以上なのに「該当しない」：特定適用事業所に当たる見込み（基準の人数を返す） */
  readonly suggestSpecific = computed<number | null>(() => {
    const min = this.criteriaNow()?.sizeMin ?? null;
    const typed = parseNat(this.coverageValue().insuredCount);
    const n = typed ?? this.headcount()?.counted ?? null;
    return min !== null && n !== null && n >= min && this.coverageValue().specific === 'none' ? min : null;
  });

  /** 足りない・正しくない項目の数（「登録する」を押したあとだけ。下の帯に出す） */
  readonly invalidCount = computed(() => {
    if (!this.submitTried()) return 0;
    this.value(); // 入れ直すたびに数え直す
    const fields: Field[] = [
      'name', 'corporateName', 'corporateNumber', 'ownerName', 'postalCode', 'prefecture', 'address',
      'kumiaiName', 'insurerNumber', 'officeSymbol', 'officeNumber', 'employeeCount', 'changeFrom',
    ];
    const coverage: (keyof CoverageFormValue)[] = ['hours', 'monthlyDays', 'specificSince', 'insuredCount'];
    return fields.filter((f) => this.errorOf(f)).length + coverage.filter((c) => this.coverageErrorOf(c)).length;
  });

  /** 下の帯のエラーを押したら、最初のエラーの欄へ */
  scrollToError(): void {
    const el = document.querySelector<HTMLElement>('.is-invalid');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus({ preventScroll: true });
  }

  hasWarning(w: CoverageWarning): boolean {
    return this.coverageWarns().includes(w);
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
          org: e.org ?? null,
        })),
      );
      this.people.set(people);
      this.counting.set('idle');
    } catch (err) {
      console.error(err);
      this.counting.set('failed');
    }
  }

  /**
   * 組合の名前で Enter（変換の確定は除く）：送信せず、次に入れる所へ動く（11/17）
   * 編集で切り替えるとき → 「保険者・所在地の履歴」の変更を適用する月へ。新規登録 → 下の料率の欄へ
   */
  onKumiaiEnter(e: Event): void {
    const k = e as KeyboardEvent;
    if (k.isComposing || k.keyCode === 229) return;
    e.preventDefault();
    setTimeout(() => {
      const target = document.getElementById(this.isEdit ? 'changeFrom' : 'firstRatesFrom');
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.focus({ preventScroll: true });
    });
  }

  /** 履歴の月の表示（「最初から」は文字で） */
  isStart(from: string): boolean {
    return from === FROM_THE_START;
  }

  /**
   * 履歴の行の期間（11/17）：「〜2024-03」「2024-04〜」「2024-04〜2025-02」。1行だけなら「すべての期間」
   * 「登録時から」だと、アプリに登録した日からに見えてしまうため、終わりの月で書く
   */
  periodLabel(i: number): { from: string; to: string } | null {
    const h = this.history();
    const from = this.isStart(h[i].from) ? '' : h[i].from;
    const to = h[i + 1] ? shiftMonth(h[i + 1].from, -1) : '';
    return from || to ? { from, to } : null;
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

  /** 部署が変わっていれば書く */
  private async saveDepartments(officeId: string): Promise<void> {
    const list = this.departments();
    if (JSON.stringify(list) === JSON.stringify(this.savedDepartments)) return;
    await this.offices.update(officeId, { departments: list });
    this.savedDepartments = list;
  }

  async submit(): Promise<void> {
    if (this.readOnly) return;
    const changeFrom = this.form.controls.changeFrom;
    const coverage = fromCoverageForm(this.form.controls.coverage.getRawValue());
    this.submitTried.set(true);
    if (
      this.form.invalid ||
      !coverage ||
      this.standardMissing().length > 0 ||
      (this.isEdit && this.adjustmentSinceMissing()) ||
      this.deductionFromInvalid() ||
      (this.insurerChanged() && !MONTH.test(changeFrom.value)) ||
      this.insurerNumberProblem() !== null ||
      this.readFirstRates() === false ||
      this.ratesBlocked() ||
      this.payGroupErrs().size > 0
    ) {
      this.form.markAllAsTouched();
      // 料率のファイルにエラーの行が残っているときは、その部品まで動かす
      if (this.ratesBlocked()) {
        this.rateImport()?.showBlocked();
        return;
      }
      // 帯の件数が出たあとで、最初のエラーの欄まで動かす
      setTimeout(() => this.scrollToError());
      return;
    }
    const uid = this.auth.user()?.uid;
    if (!uid) return;

    this.submitting.set(true);
    this.saved.set(false);
    this.errorKey.set(null);

    const v = this.form.getRawValue();
    const period = this.periodFromForm();
    // 閉じた欄の値は保存しない（チェックを外した ＝ 使わない）
    const filing = this.openFiling();
    const base = {
      name: v.name.trim(),
      nameEn: this.openNameEn() ? emptyToNull(v.nameEn) : null,
      groupName: this.openGroup() ? emptyToNull(v.groupName) : null,
      corporateName: emptyToNull(v.corporateName),
      corporateNumber: emptyToNull(v.corporateNumber),
      ownerName: v.ownerName.trim(),
      postalCode: v.postalCode ? v.postalCode.replace('-', '') : null,
      prefecture: period.prefecture,
      address: v.address.trim(),
      healthInsurer: period.healthInsurer,
      officeSymbol: filing ? emptyToNull(v.officeSymbol) : null,
      officeNumber: filing ? emptyToNull(v.officeNumber) : null,
      industry: v.industry || null,
      employeeCount: filing ? (v.employeeCount ?? null) : null,
      payroll: {
        closingDay: Number(v.closingDay),
        payMonth: v.payMonth,
        payDay: Number(v.payDay),
        deduction: v.deduction,
      },
      premium: { method: v.method, healthRounding: v.healthRounding, agreementRounding: v.agreementRounding || null },
      ...coverage,
    };

    try {
      const office = this.office();
      if (office) {
        // 編集：保険者・都道府県が変わったら「何月分から」を履歴に足す（最新の行は今の値と同じになる）
        // 保険者が変わらないまま名前・保険者番号を入れ直したら、今の保険者の行も合わせる（11/26）
        const history = this.insurerChanged()
          ? withInsurerChange(insurerHistoryOf(office), { from: changeFrom.value, ...period })
          : withInsurerDetails(insurerHistoryOf(office), period.healthInsurer);
        const input: OfficeInput = {
          ...base,
          insurerHistory: history,
          // 保険料調整制度は編集のときだけ書く（作るときの項目の決まりを変えないため）
          premiumAdjustment: v.adjustmentOn && MONTH.test(v.adjustmentSince) ? { since: v.adjustmentSince } : null,
          // 給与の支払区分（編集のときだけ書く。名前の前後の空白は落とす。11/24）
          payGroups: this.payGroups().map((g) => ({ ...g, name: g.name.trim() })),
          // 控除の時期を変えたら「何月分から」を履歴に足す（変えていなければ書かない＝今の履歴のまま。11/20）
          ...(this.deductionChanged()
            ? {
                deductionHistory: withDeductionChange(office.deductionHistory, payrollOf(office).deduction, {
                  from: v.deductionFrom,
                  deduction: v.deduction,
                }),
              }
            : {}),
        };
        const firstRate = this.readFirstRates();
        await this.offices.update(office.id, input, this.tasksOf(this.pendingChanges()));
        await this.saveDepartments(office.id);
        for (const r of this.ratesToWrite(firstRate || null)) await this.rates.createKumiai(office.id, r);
        this.firstRates.reset();
        this.clearRatesFile();
        this.changeFactDate.set(todayLocal());
        const fresh = await this.offices.get(office.id);
        if (fresh) {
          this.context.setCurrent(fresh); // 保険料の画面などに、新しい設定をすぐ反映
          this.fillFrom(fresh);
        }
        await this.context.refresh(uid); // 切り替えの一覧の名前なども最新に
        this.form.markAsUntouched();
        this.form.markAsPristine();
        this.saved.set(true);
        this.toast.show('common.saved');
      } else {
        // 新規登録：履歴は「最初から今の値」の1行
        const input: OfficeInput = {
          ...base,
          insurerHistory: [{ from: FROM_THE_START, ...period }],
        };
        const firstRate = this.readFirstRates();
        const officeId = await this.offices.create(uid, input);
        // 部署は作ったあとに足す（作るときの項目の決まりを変えないため）
        await this.saveDepartments(officeId);
        // 組合の最初の料率（入れていれば）。事業所ができてからでないと書けない
        for (const r of this.ratesToWrite(firstRate || null)) await this.rates.createKumiai(officeId, r);
        await this.profiles.load(uid); // currentOfficeId を最新にする
        await this.context.refresh(uid); // 切り替えの一覧にすぐ反映
        this.unsaved.release();
        await this.router.navigateByUrl(`/o/${officeId}`);
      }
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'office.error.save'));
    } finally {
      this.submitting.set(false);
    }
  }
}
