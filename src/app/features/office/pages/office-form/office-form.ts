import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../../../core/auth/auth.service';
import { UserProfileService } from '../../../../core/auth/user-profile.service';
import { LanguageService } from '../../../../core/i18n/language.service';
import { INDUSTRIES } from '../../../../core/master/industries';
import { PREFECTURES } from '../../../../core/master/prefectures';
import { HealthInsurerType, Office, OfficeInput } from '../../../../core/models/office';
import { PostalCodeService } from '../../../../shared/services/postal-code.service';
import { corporateNumberValidator } from '../../../../shared/validators/corporate-number';
import { OfficeService } from '../../office.service';
import { OfficeContext } from '../../office-context.service';

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

type Field =
  | 'name' | 'corporateName' | 'corporateNumber' | 'ownerName' | 'industry'
  | 'postalCode' | 'prefecture' | 'address' | 'kumiaiName'
  | 'officeSymbol' | 'officeNumber' | 'employeeCount';

const PATTERN_ERROR: Partial<Record<Field, string>> = {
  postalCode: 'office.validation.postalCode',
  officeNumber: 'office.validation.digits',
};

const emptyToNull = (v: string) => (v.trim() ? v.trim() : null);

@Component({
  selector: 'app-office-form',
  imports: [ReactiveFormsModule, RouterLink, TranslocoPipe],
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
  private readonly language = inject(LanguageService);
  private readonly context = inject(OfficeContext);

  readonly prefectures = PREFECTURES;
  readonly industries = INDUSTRIES;
  readonly lang = computed(() => (this.language.lang() === 'en' ? 'en' : 'ja'));

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
      employeeCount: this.fb.control<number | null>(null, [Validators.min(0), Validators.max(1000000)]),
    },
    { validators: [corporateNameRequired, kumiaiNameRequired] },
  );

  readonly insurerType = toSignal(this.form.controls.insurerType.valueChanges, {
    initialValue: this.form.controls.insurerType.value,
  });

  readonly myOffices = signal<Office[]>([]);
  readonly copied = signal(false);
  readonly postalStatus = signal<'idle' | 'loading' | 'notFound' | 'failed'>('idle');
  readonly submitting = signal(false);
  readonly errorKey = signal<string | null>(null);

  constructor() {
    const uid = this.auth.user()?.uid;
    if (uid) {
      this.offices
        .listMine(uid)
        .then((list) => this.myOffices.set(list))
        .catch((err) => console.error(err));
    }
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
    this.form.patchValue({
      corporateName: o.corporateName ?? '',
      corporateNumber: o.corporateNumber ?? '',
      ownerName: o.ownerName,
      insurerType: o.healthInsurer.type,
      kumiaiName: o.healthInsurer.kumiaiName ?? '',
      industry: o.industry ?? '',
    });
    this.copied.set(true);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const uid = this.auth.user()?.uid;
    if (!uid) return;

    this.submitting.set(true);
    this.errorKey.set(null);

    const v = this.form.getRawValue();
    const input: OfficeInput = {
      name: v.name.trim(),
      corporateName: emptyToNull(v.corporateName),
      corporateNumber: emptyToNull(v.corporateNumber),
      ownerName: v.ownerName.trim(),
      postalCode: v.postalCode ? v.postalCode.replace('-', '') : null,
      prefecture: v.prefecture,
      address: v.address.trim(),
      healthInsurer: {
        type: v.insurerType,
        kumiaiName: v.insurerType === 'kumiai' ? v.kumiaiName.trim() : null,
      },
      officeSymbol: emptyToNull(v.officeSymbol),
      officeNumber: emptyToNull(v.officeNumber),
      industry: v.industry || null,
      employeeCount: v.employeeCount ?? null,
    };

    try {
      const officeId = await this.offices.create(uid, input);
      await this.profiles.load(uid); // currentOfficeId を最新にする
      await this.context.refresh(uid); // 切り替えの一覧にすぐ反映
      await this.router.navigateByUrl(`/o/${officeId}`);
    } catch (err) {
      console.error(err);
      this.errorKey.set('office.error.save');
    } finally {
      this.submitting.set(false);
    }
  }
}