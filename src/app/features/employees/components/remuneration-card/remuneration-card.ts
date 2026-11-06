import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { GradeTableDoc } from '../../../../core/models/rates';
import {
  REMUNERATION_REASONS,
  RemunerationDoc,
  RemunerationInput,
  RemunerationReason,
  StandardRemuneration,
} from '../../../../core/models/remuneration';
import { todayLocal, toYearMonth } from '../../../../shared/utils/date';
import { OfficeContext } from '../../../office/office-context.service';
import { decideStandard, parseYen, pickGradeTable } from '../../../rates/logic/grade';
import { formatYen } from '../../../../shared/utils/number';
import { latest } from '../../../rates/logic/pick-rates';
import { RateService } from '../../../rates/rate.service';
import { RemunerationService } from '../../remuneration.service';

import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
type Kind = 'health' | 'pension';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEN = /^[0-9０-９,，\s]+$/;

@Component({
  selector: 'app-remuneration-card',
  imports: [HalfWidthDigits, ReactiveFormsModule, TranslocoPipe],
  templateUrl: './remuneration-card.html',
  styleUrl: './remuneration-card.css',
})
export class RemunerationCard implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(RemunerationService);
  private readonly rates = inject(RateService);
  readonly context = inject(OfficeContext);

  readonly employee = input.required<Employee>();

  /** 保存・削除したことを知らせる（保険料カードが計算し直すため） */
  readonly changed = output<void>();

  readonly reasons = REMUNERATION_REASONS;
  readonly kinds: Kind[] = ['health', 'pension'];
  readonly thisMonth = toYearMonth(todayLocal());
  readonly yen = formatYen;

  // ===== 箱 =====
  readonly rows = signal<RemunerationDoc[]>([]);
  readonly gradeTables = signal<GradeTableDoc[]>([]);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);
  /** 編集中のフォーム：null は閉じている、'new' は追加、それ以外は編集中の適用開始月 */
  readonly editing = signal<'new' | string | null>(null);
  readonly confirmingDelete = signal<string | null>(null);
  readonly saving = signal(false);
  /** フォームの適用開始月（等級表の選択に使う） */
  private readonly formMonth = signal('');
  /** フォームの報酬月額（読めないときは null） */
  private readonly formAmount = signal<number | null>(null);

  /** 等級を自動で決められないときの理由（決められるときは null） */
  readonly autoStatus = computed<string | null>(() => {
    if (this.gradeTables().length === 0) return 'remuneration.status.noMaster';
    if (!this.formMonth()) return 'remuneration.status.needMonth';
    const t = this.tableFor();
    if (!t.health || !t.pension) return 'remuneration.status.noTable';
    if (this.formAmount() === null) return 'remuneration.status.needAmount';
    return null;
  });

  /** 今月に使われている行（一覧で目立たせる） */
  readonly currentFrom = computed(() => latest(this.rows(), this.thisMonth)?.from ?? null);

  /** フォームの適用開始月で使う等級表（等級の選択肢になる） */
  readonly tableFor = computed(() => ({
    health: pickGradeTable(this.gradeTables(), 'health', this.formMonth()),
    pension: pickGradeTable(this.gradeTables(), 'pension', this.formMonth()),
  }));

  readonly form = this.fb.nonNullable.group({
    from: ['', [Validators.required, Validators.pattern(MONTH)]],
    reason: ['acquisition' as RemunerationReason, [Validators.required]],
    monthlyAmount: ['', [Validators.required, Validators.pattern(YEN)]],
    healthGrade: ['', [Validators.required]],
    pensionGrade: ['', [Validators.required]],
  });

  /** 直前に自動で選んだ等級（手で選び直したかの判定に使う） */
  private lastAuto: Record<Kind, string> = { health: '', pension: '' };

  constructor() {
    this.form.controls.from.valueChanges.subscribe((v) => {
      this.formMonth.set(MONTH.test(v) ? v : '');
      this.autoGrades();
    });
    this.form.controls.monthlyAmount.valueChanges.subscribe((v) => {
      this.formAmount.set(parseYen(v));
      this.autoGrades();
    });
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
      const [rows, tables] = await Promise.all([
        this.api.list(officeId, this.employee().id),
        this.rates.grades(),
      ]);
      this.rows.set(rows);
      this.gradeTables.set(tables);
    } catch (err) {
      console.error(err);
      this.errorKey.set('remuneration.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  // ===== 等級の自動選択 =====

  /** 報酬月額と適用開始月から等級を出す（手で選び直した等級は上書きしない） */
  private autoGrades(): void {
    const amount = parseYen(this.form.controls.monthlyAmount.value);
    const month = this.formMonth();
    if (amount === null || !month) return;
    const d = decideStandard(this.gradeTables(), month, amount);
    this.setAuto('health', this.form.controls.healthGrade, d.health);
    this.setAuto('pension', this.form.controls.pensionGrade, d.pension);
  }

  private setAuto(kind: Kind, c: FormControl<string>, r: StandardRemuneration | null): void {
    const v = r ? String(r.grade) : '';
    if (!c.value || c.value === this.lastAuto[kind]) c.setValue(v);
    this.lastAuto[kind] = v;
  }

  /** 選んだ等級が、報酬月額から出した等級と違う（決定通知書に合わせて選び直した） */
  isManual(kind: Kind): boolean {
    const c = kind === 'health' ? this.form.controls.healthGrade : this.form.controls.pensionGrade;
    return !!c.value && c.value !== this.lastAuto[kind];
  }

  // ===== 追加・編集・削除 =====

  startAdd(): void {
    this.lastAuto = { health: '', pension: '' };
    this.form.reset({
      from: '',
      reason: 'acquisition',
      monthlyAmount: '',
      healthGrade: '',
      pensionGrade: '',
    });
    this.form.controls.from.enable();
    this.errorKey.set(null);
    this.editing.set('new');
  }

  startEdit(row: RemunerationDoc): void {
    // 保存済みの金額から出した等級を「自動の値」にする（手で選び直していた等級はそのまま残る）
    const d = decideStandard(this.gradeTables(), row.from, row.monthlyAmount);
    this.lastAuto = {
      health: d.health ? String(d.health.grade) : '',
      pension: d.pension ? String(d.pension.grade) : '',
    };
    this.form.setValue(
      {
        from: row.from,
        reason: row.reason,
        monthlyAmount: formatYen(row.monthlyAmount),
        healthGrade: String(row.health.grade),
        pensionGrade: String(row.pension.grade),
      },
      { emitEvent: false },
    );
    this.formMonth.set(row.from);
    this.form.controls.from.disable(); // 適用開始月はドキュメントIDなので変えられない
    this.errorKey.set(null);
    this.editing.set(row.from);
  }

  cancel(): void {
    this.editing.set(null);
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const officeId = this.officeId;
    const v = this.form.getRawValue();
    const amount = parseYen(v.monthlyAmount);
    const table = this.tableFor();
    const health = table.health?.grades.find((g) => g.grade === Number(v.healthGrade));
    const pension = table.pension?.grades.find((g) => g.grade === Number(v.pensionGrade));
    if (!officeId || amount === null || !health || !pension) {
      this.errorKey.set(
        amount === null ? 'remuneration.error.amount' : 'remuneration.error.noTable',
      );
      return;
    }
    const isNew = this.editing() === 'new';
    if (isNew && this.rows().some((r) => r.from === v.from)) {
      this.errorKey.set('remuneration.error.duplicate');
      return;
    }

    const input: RemunerationInput = {
      from: v.from,
      reason: v.reason,
      monthlyAmount: amount,
      health: { grade: health.grade, standard: health.standard },
      pension: { grade: pension.grade, standard: pension.standard },
    };

    this.saving.set(true);
    this.errorKey.set(null);
    try {
      if (isNew) await this.api.create(officeId, this.employee().id, input);
      else await this.api.update(officeId, this.employee().id, input);
      this.editing.set(null);
      await this.load();
      this.changed.emit();
    } catch (err) {
      console.error(err);
      this.errorKey.set('remuneration.error.save');
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
      this.errorKey.set('remuneration.error.save');
    } finally {
      this.saving.set(false);
    }
  }

  /** 項目のエラー（触る前・正しいときは null） */
  errorOf(name: 'from' | 'monthlyAmount' | 'healthGrade' | 'pensionGrade'): string | null {
    const c = this.form.controls[name];
    if (!c.touched || !c.errors) return null;
    if (c.hasError('required')) return 'remuneration.validation.required';
    return name === 'from' ? 'remuneration.validation.month' : 'remuneration.validation.amount';
  }
}
