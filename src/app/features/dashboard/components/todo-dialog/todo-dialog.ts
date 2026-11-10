import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { LOSS_REASONS, LossReason } from '../../../../core/models/employee';
import { GradeTableDoc } from '../../../../core/models/rates';
import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
import { DATE_RE, todayLocal, toYearMonth } from '../../../../shared/utils/date';
import { RemunerationService } from '../../../employees/remuneration.service';
import { OfficeContext } from '../../../office/office-context.service';
import { pickGradeTable } from '../../../rates/logic/grade';
import { RateService } from '../../../rates/rate.service';
import {
  actionErrors,
  ActionFormValue,
  actionForm,
  ActionPerson,
  ActionRequest,
  autoGrades,
  buildSave,
} from '../../logic/todo-actions';
import { TodoService } from '../../todo.service';

/**
 * To-do をその場で片づける窓（資格取得届・資格喪失届・区分変更届）
 * 閉じ方（×・背景・Esc・やめる）はどれも保存しない（rate-dialog と同じ作り）
 */
@Component({
  selector: 'app-todo-dialog',
  imports: [HalfWidthDigits, ReactiveFormsModule, TranslocoPipe],
  templateUrl: './todo-dialog.html',
  styleUrl: './todo-dialog.css',
})
export class TodoDialog implements OnInit {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly rates = inject(RateService);
  private readonly remApi = inject(RemunerationService);
  private readonly api = inject(TodoService);
  private readonly context = inject(OfficeContext);

  readonly request = input.required<ActionRequest>();
  readonly person = input.required<ActionPerson>();
  readonly employeeName = input('');

  readonly saved = output<void>();
  readonly closed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  readonly today = todayLocal();
  readonly lossReasons = LOSS_REASONS;

  readonly tables = signal<GradeTableDoc[]>([]);
  /** 標準報酬が登録済みの月（取得届の窓で、上書きしないため） */
  readonly savedMonths = signal<string[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly tried = signal(false);
  readonly errorKey = signal<string | null>(null);

  // 中身は ngOnInit で、開いた To-do に合わせて入れる
  readonly form = this.fb.group({
    date: '',
    health: false,
    pension: false,
    reason: this.fb.control<LossReason>('retire'),
    amount: '',
    healthGrade: '',
    pensionGrade: '',
    submittedOn: '',
  });
  private readonly value = signal<ActionFormValue>(this.form.getRawValue());

  readonly mode = computed(() => this.request().mode);
  readonly month = computed(() => (DATE_RE.test(this.value().date) ? toYearMonth(this.value().date) : ''));
  /** 取得月の標準報酬がもうある（報酬月額と等級は入れない） */
  readonly monthSaved = computed(() => this.savedMonths().includes(this.month()));
  readonly healthRows = computed(() => pickGradeTable(this.tables(), 'health', this.month())?.grades ?? []);
  readonly pensionRows = computed(() => pickGradeTable(this.tables(), 'pension', this.month())?.grades ?? []);

  readonly errors = computed(() => {
    const e = actionErrors(this.value(), this.request(), this.person(), this.tables());
    if (this.monthSaved()) {
      delete e.amount;
      delete e.healthGrade;
    }
    return e;
  });

  /** 背景で押し始めたか（窓の中で押して背景で離したときに閉じないため） */
  private pressedOnBackdrop = false;

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.showModal());
    this.form.valueChanges.subscribe(() => this.value.set(this.form.getRawValue()));
    // 日付・報酬月額が変わったら、等級を候補に入れ直す（等級を選び直したあとでも、元の金額が変われば入れ直す）
    this.form.controls.date.valueChanges.subscribe(() => this.fillGrades());
    this.form.controls.amount.valueChanges.subscribe(() => this.fillGrades());
  }

  ngOnInit(): void {
    this.form.setValue(actionForm(this.request(), this.today));
    void this.load();
  }

  private async load(): Promise<void> {
    const officeId = this.context.current()?.id;
    try {
      if (this.mode() === 'acquire' && officeId) {
        const [tables, rems] = await Promise.all([
          this.rates.grades(),
          this.remApi.list(officeId, this.request().employeeId),
        ]);
        this.tables.set(tables);
        this.savedMonths.set(rems.map((r) => r.from));
        this.fillGrades();
      }
    } catch (err) {
      console.error(err);
      this.errorKey.set('todoAction.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  private fillGrades(): void {
    const v = this.form.getRawValue();
    const g = autoGrades(this.tables(), v.date, v.amount);
    this.form.patchValue({ healthGrade: g.health, pensionGrade: g.pension }, { emitEvent: false });
    this.value.set(this.form.getRawValue());
  }

  errorOf(field: keyof ActionFormValue): string | null {
    const e = this.errors()[field];
    return this.tried() && e ? `todoAction.error.${e}` : null;
  }

  standardOf(rows: { grade: number; standard: number }[], grade: string): number | null {
    return rows.find((r) => String(r.grade) === grade)?.standard ?? null;
  }

  yen(n: number): string {
    return n.toLocaleString('ja-JP');
  }

  async save(): Promise<void> {
    this.tried.set(true);
    if (Object.keys(this.errors()).length > 0 || this.saving()) return;
    const officeId = this.context.current()?.id;
    const s = buildSave(this.value(), this.request(), this.person(), this.tables(), this.savedMonths());
    if (!officeId || !s) return;
    this.saving.set(true);
    this.errorKey.set(null);
    try {
      await this.api.save(officeId, this.request().employeeId, s, this.request().dismissKey);
      this.saved.emit();
      this.close();
    } catch (err) {
      console.error(err);
      this.errorKey.set('todoAction.error.save');
    } finally {
      this.saving.set(false);
    }
  }

  // ===== 閉じる（×・背景・Esc。どれも保存はしない） =====

  close(): void {
    this.dialog().nativeElement.close(); // → close イベント → onClosed
  }

  onPointerDown(e: PointerEvent): void {
    this.pressedOnBackdrop = e.target === this.dialog().nativeElement;
  }

  onClick(e: MouseEvent): void {
    if (this.pressedOnBackdrop && e.target === this.dialog().nativeElement) this.close();
    this.pressedOnBackdrop = false;
  }

  onClosed(): void {
    this.closed.emit();
  }
}
