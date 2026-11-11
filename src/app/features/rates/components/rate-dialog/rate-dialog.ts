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
import { ImportFileError, MAX_FILE_BYTES } from '../../../../shared/import/parse';
import { findRates, guessFill, RateCandidate } from '../../logic/rate-pdf';
import { TranslocoPipe } from '@jsverse/transloco';
import { HealthInsurer } from '../../../../core/models/office';
import {
  KumiaiRateInput,
  MasterRateDoc,
  MonthRange,
  RateMicro,
  RateSplit,
} from '../../../../core/models/rates';
import { shiftMonth } from '../../../../shared/utils/date';
import { inRange, kyokaiChanges } from '../../logic/rate-changes';
import {
  formatRate,
  formatRateInput,
  parseRate,
  parseSplit,
  RateUnit,
} from '../../logic/rate-format';
import { RateService } from '../../rate.service';

import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
/** 窓で扱う期間と保険者（開く側で、保存済みの履歴から作る） */
export interface RateDialogTarget {
  officeId: string;
  prefecture: string; // '01'〜'47'
  prefectureName: string; // 表示用
  insurer: HealthInsurer;
  /** 組合健保は「同じ組合が続く期間」、協会けんぽは履歴の1行の期間 */
  range: MonthRange;
  /** 期間の始まりが分かっているか（「登録時から」の行は false） */
  startKnown: boolean;
}

type Kind = 'health' | 'care' | 'childSupport';
type ErrorField = 'from' | Kind;

const KINDS: readonly Kind[] = ['health', 'care', 'childSupport'];
const FIELDS = ['total', 'employee', 'employer'] as const;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const NEW = 'new';

/** 支援金の初期値：0.23%（本人・会社で半分ずつ）。2026年4月分から */
const CHILD_SUPPORT_DEFAULT: RateSplit = { employee: 1150, employer: 1150 };

@Component({
  selector: 'app-rate-dialog',
  imports: [HalfWidthDigits, ReactiveFormsModule, TranslocoPipe],
  templateUrl: './rate-dialog.html',
  styleUrl: './rate-dialog.css',
})
export class RateDialog implements OnInit {
  private readonly rates = inject(RateService);
  private readonly fb = inject(FormBuilder);

  readonly target = input.required<RateDialogTarget>();
  /** 管理者なら true（組合健保の期間だけ編集できる） */
  readonly canEdit = input(false);
  readonly closed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly kinds = KINDS;
  readonly fields = FIELDS;

  /** 表示と入力の単位。窓を閉じたら % に戻る（窓ごとに作り直すため） */
  readonly unit = signal<RateUnit>('percent');
  readonly symbol = computed(() => (this.unit() === 'percent' ? '%' : '‰'));

  readonly loading = signal(true);
  readonly loadError = signal(false);
  private readonly master = signal<MasterRateDoc[]>([]);
  private readonly kumiaiAll = signal<KumiaiRateInput[]>([]);

  readonly isKumiai = computed(() => this.target().insurer.type === 'kumiai');
  readonly editable = computed(() => this.canEdit() && this.isKumiai());
  readonly range = computed(() => this.target().range);
  /** 期間の最後の月（今も続いていれば null） */
  readonly lastMonth = computed(() => {
    const to = this.range().to;
    return to ? shiftMonth(to, -1) : null;
  });
  readonly minMonth = computed(() => (this.target().startKnown ? this.range().from : null));

  /** この期間の組合の料率（古い順） */
  readonly kumiaiRows = computed(() =>
    this.kumiaiAll()
      .filter((k) => inRange(k.from, this.range()))
      .sort((a, b) => a.from.localeCompare(b.from)),
  );
  readonly kyokaiRows = computed(() =>
    kyokaiChanges(this.master(), this.target().prefecture, this.range()),
  );

  /** 組合の期間の始まりの月に料率がない（その月から「料率が未登録」になる） */
  readonly missingStart = computed(
    () =>
      this.isKumiai() &&
      this.target().startKnown &&
      !this.loading() &&
      !this.loadError() &&
      !this.kumiaiRows().some((k) => k.from === this.range().from),
  );

  /** 入力中：'new'（追加）か、編集中の適用開始月。入力していなければ null */
  readonly editing = signal<string | null>(null);
  readonly errors = signal<Partial<Record<ErrorField, string>>>({});
  readonly saving = signal(false);
  readonly saveError = signal(false);
  readonly confirmDelete = signal<string | null>(null);

  // ===== PDF から読み取る（組合のお知らせ） =====
  /** 拾った料率の候補（行の文字つき） */
  readonly pdfCandidates = signal<RateCandidate[]>([]);
  readonly pdfReading = signal(false);
  readonly pdfError = signal<string | null>(null);
  /** 推して入れた欄の数（「○つの欄に入れました」） */
  readonly pdfFilled = signal<number | null>(null);
  /** 最後に選んだ欄（候補を押すと、ここに入る） */
  readonly targetField = signal<{ kind: Kind; field: (typeof FIELDS)[number] } | null>(null);

  readonly form = this.fb.nonNullable.group({
    from: [''],
    health: this.splitGroup(),
    care: this.splitGroup(),
    childSupport: this.splitGroup(),
  });

  /** 背景で押し始めたか（窓の中で押して背景で離したときに閉じないため） */
  private pressedOnBackdrop = false;

  constructor() {
    // 画面に出てから showModal（背景が暗くなり、Esc で閉じられ、フォーカスが窓の中に入る）
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }

  ngOnInit(): void {
    void this.load();
  }

  private splitGroup() {
    return this.fb.nonNullable.group({ total: [''], employee: [''], employer: [''] });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(false);
    try {
      if (this.isKumiai()) {
        this.kumiaiAll.set(await this.rates.kumiaiList(this.target().officeId));
      } else {
        this.master.set(await this.rates.master());
      }
    } catch (err) {
      console.error(err);
      this.loadError.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  // ===== 閉じる（×・背景・Esc。どれも保存はしない） =====

  close(): void {
    this.dialog().nativeElement.close(); // → close イベント → onClosed
  }

  onPointerDown(e: PointerEvent): void {
    this.pressedOnBackdrop = e.target === this.dialog().nativeElement;
  }

  /** 窓の外側（背景）は dialog 要素そのものに当たる。押し始めも背景のときだけ閉じる */
  onClick(e: MouseEvent): void {
    if (this.pressedOnBackdrop && e.target === this.dialog().nativeElement) this.close();
    this.pressedOnBackdrop = false;
  }

  onClosed(): void {
    this.closed.emit();
  }

  // ===== 表示 =====

  show(rate: RateMicro): string {
    return formatRate(rate, this.unit());
  }

  totalOf(s: RateSplit): RateMicro {
    return s.employee + s.employer;
  }

  /** 単位の切り替え。入力中の値も新しい単位に書き換える（読めない値はそのまま） */
  setUnit(next: RateUnit): void {
    const prev = this.unit();
    if (prev === next) return;
    if (this.editing()) {
      for (const kind of KINDS) {
        const group = this.form.controls[kind].controls;
        for (const f of FIELDS) {
          const v = parseRate(group[f].value, prev);
          if (v !== null) group[f].setValue(formatRateInput(v, next));
        }
      }
    }
    this.unit.set(next);
  }

  // ===== 追加・編集・削除（組合健保のみ） =====

  startNew(): void {
    const r = this.range();
    // 始まりの月の料率がなければ、その月を最初から入れておく
    const from = this.missingStart() ? r.from : '';
    this.form.reset();
    this.form.controls.from.enable();
    this.form.patchValue({ from, childSupport: this.texts(CHILD_SUPPORT_DEFAULT) });
    this.openEdit(NEW);
  }

  startEdit(k: KumiaiRateInput): void {
    this.form.reset();
    this.form.controls.from.disable(); // 適用開始月はドキュメントIDなので変えない（変えるなら削除して追加）
    this.form.patchValue({
      from: k.from,
      health: this.texts(k.health),
      care: this.texts(k.care),
      childSupport: this.texts(k.childSupport),
    });
    this.openEdit(k.from);
  }

  private openEdit(mode: string): void {
    this.pdfCandidates.set([]);
    this.pdfError.set(null);
    this.pdfFilled.set(null);
    this.targetField.set(null);
    this.errors.set({});
    this.saveError.set(false);
    this.confirmDelete.set(null);
    this.editing.set(mode);
  }

  cancelEdit(): void {
    this.editing.set(null);
    this.errors.set({});
  }

  private texts(s: RateSplit) {
    const u = this.unit();
    return {
      total: formatRateInput(s.employee + s.employer, u),
      employee: formatRateInput(s.employee, u),
      employer: formatRateInput(s.employer, u),
    };
  }

  /** PDF を読み、推した値を空の欄にだけ入れ、拾った数字を全部候補に並べる */
  async readPdf(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // 同じファイルを選び直しても反応するように
    if (!file) return;
    this.pdfReading.set(true);
    this.pdfError.set(null);
    this.pdfFilled.set(null);
    try {
      if (file.size > MAX_FILE_BYTES) throw new ImportFileError('tooBig');
      const { readPdfLines } = await import('../../../../shared/import/pdf');
      const cands = findRates(await readPdfLines(await file.arrayBuffer()));
      this.pdfCandidates.set(cands);
      if (!cands.length) {
        this.pdfError.set('rateDialog.pdf.none');
        return;
      }
      let filled = 0;
      for (const [key, rate] of Object.entries(guessFill(cands))) {
        const [kind, field] = key.split('.') as [Kind, (typeof FIELDS)[number]];
        const control = this.form.controls[kind].controls[field];
        if (control.value.trim() === '' && rate !== undefined) {
          control.setValue(formatRateInput(rate, this.unit()));
          filled++;
        }
      }
      this.pdfFilled.set(filled);
    } catch (err) {
      console.error(err);
      this.pdfError.set(err instanceof ImportFileError ? `importMap.error.${err.code}` : 'rateDialog.pdf.failed');
    } finally {
      this.pdfReading.set(false);
    }
  }

  /** 候補を押す：最後に選んだ欄に入れる */
  useCandidate(c: RateCandidate): void {
    const t = this.targetField();
    if (!t) return;
    this.form.controls[t.kind].controls[t.field].setValue(formatRateInput(c.rate, this.unit()));
  }

  isTarget(kind: Kind, field: string): boolean {
    const t = this.targetField();
    return !!t && t.kind === kind && t.field === field;
  }

  async save(): Promise<void> {
    const mode = this.editing();
    if (!mode || !this.editable() || this.saving()) return;
    const t = this.target();
    const v = this.form.getRawValue();

    const errors: Partial<Record<ErrorField, string>> = {};
    if (mode === NEW) {
      if (!MONTH.test(v.from) || !inRange(v.from, t.range)) {
        errors.from = 'rateDialog.error.fromRange';
      } else if (this.kumiaiAll().some((k) => k.from === v.from)) {
        errors.from = 'rateDialog.error.duplicate';
      }
    }
    const parsed: Partial<Record<Kind, RateSplit>> = {};
    for (const kind of KINDS) {
      const r = parseSplit(v[kind], this.unit());
      if (r.ok) parsed[kind] = r.split;
      else errors[kind] = `rateDialog.error.${r.error}`;
    }
    this.errors.set(errors);
    if (Object.keys(errors).length > 0 || !parsed.health || !parsed.care || !parsed.childSupport) {
      return;
    }

    const input: KumiaiRateInput = {
      from: mode === NEW ? v.from : mode,
      health: parsed.health,
      care: parsed.care,
      childSupport: parsed.childSupport,
    };

    this.saving.set(true);
    this.saveError.set(false);
    try {
      if (mode === NEW) await this.rates.createKumiai(t.officeId, input);
      else await this.rates.updateKumiai(t.officeId, input);
      this.kumiaiAll.set(await this.rates.kumiaiList(t.officeId));
      this.editing.set(null);
    } catch (err) {
      console.error(err);
      this.saveError.set(true);
    } finally {
      this.saving.set(false);
    }
  }

  /** 1回目で確認の表示、2回目で削除 */
  async remove(from: string): Promise<void> {
    if (this.confirmDelete() !== from) {
      this.confirmDelete.set(from);
      return;
    }
    const t = this.target();
    this.saving.set(true);
    this.saveError.set(false);
    try {
      await this.rates.deleteKumiai(t.officeId, from);
      this.kumiaiAll.set(await this.rates.kumiaiList(t.officeId));
      this.confirmDelete.set(null);
    } catch (err) {
      console.error(err);
      this.saveError.set(true);
    } finally {
      this.saving.set(false);
    }
  }
}
