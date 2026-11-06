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
  OfficeBasicInput,
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
  imports: [ReactiveFormsModule, RouterLink, TranslocoPipe, RateDialog],
  templateUrl: './office-form.html',
  styleUrl: './office-form.css',
})
export class OfficeForm {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly profiles = inject(UserProfileService);
  private readonly offices = inject(OfficeService);
  private readonly postal = inject(PostalCodeService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly language = inject(LanguageService);
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

  readonly myOffices = signal<Office[]>([]);
  readonly copied = signal(false);
  readonly postalStatus = signal<'idle' | 'loading' | 'notFound' | 'failed'>('idle');
  readonly submitting = signal(false);
  readonly saved = signal(false);
  readonly errorKey = signal<string | null>(null);

  constructor() {
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
    this.copied.set(true);
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
    if (this.form.invalid || (this.insurerChanged() && !MONTH.test(changeFrom.value))) {
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
    };

    try {
      const office = this.office();
      if (office) {
        // 編集：保険者・都道府県が変わったら「何月分から」を履歴に足す（最新の行は今の値と同じになる）
        const history = this.insurerChanged()
          ? withInsurerChange(insurerHistoryOf(office), { from: changeFrom.value, ...period })
          : insurerHistoryOf(office);
        const input: OfficeBasicInput = { ...base, insurerHistory: history };
        await this.offices.update(office.id, input);
        const fresh = await this.offices.get(office.id);
        if (fresh) {
          this.context.setCurrent(fresh); // 保険料の画面などに、新しい設定をすぐ反映
          this.fillFrom(fresh);
        }
        await this.context.refresh(uid); // 切り替えの一覧の名前なども最新に
        this.form.markAsUntouched();
        this.saved.set(true);
      } else {
        // 新規登録：履歴は「最初から今の値」の1行
        const input: OfficeBasicInput = {
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
