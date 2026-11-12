import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CriteriaDoc } from '../../../../core/models/master';
import { CriteriaService } from '../../../office/criteria.service';
import { classify, isInsured, reasonParams } from '../../logic/classify';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { ContractDoc } from '../../../../core/models/contract';
import { Employee } from '../../../../core/models/employee';
import { todayLocal } from '../../../../shared/utils/date';
import { formatHours, formatYen } from '../../../../shared/utils/number';
import { OfficeContext } from '../../../office/office-context.service';
import { ContractService } from '../../contract.service';
import {
  contractAt,
  ContractFormValue,
  emptyContractForm,
  fromContractForm,
  nextContractForm,
  toContractForm,
} from '../../logic/contract-form-model';
import { ContractFields } from '../contract-fields/contract-fields';
import { ImportFileError } from '../../../../shared/import/parse';
import { ContractCandidate, ContractPdfRead, readContractText } from '../../logic/contract-pdf';

/** 契約書の PDF の上限（読み取りの部品と同じ 5MB） */
const MAX_PDF_BYTES = 5 * 1024 * 1024;

/**
 * 雇用契約の履歴（契約書の束：変わるたびに上に重ねる）
 * 被保険者区分の判定は、事業所の規模などと合わせて後で出す。ここでは事実を入れるだけ
 */
@Component({
  selector: 'app-contract-card',
  imports: [ContractFields, ReactiveFormsModule, TranslocoPipe],
  templateUrl: './contract-card.html',
  styleUrl: './contract-card.css',
})
export class ContractCard implements OnInit {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(ContractService);
  private readonly criteriaApi = inject(CriteriaService);
  readonly context = inject(OfficeContext);

  readonly employee = input.required<Employee>();
  /** 保存・削除したことを知らせる */
  readonly changed = output<void>();

  readonly yen = formatYen;
  readonly hoursText = formatHours;
  readonly today = todayLocal();

  // ===== 箱 =====
  readonly rows = signal<ContractDoc[]>([]);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);
  /** null は閉じている、'new' は追加、それ以外は編集中の始まる日 */
  readonly editing = signal<'new' | string | null>(null);
  readonly confirmingDelete = signal<string | null>(null);
  /** 同じ始まる日の契約がある → 上書きしてよいかの確認中 */
  readonly confirmingOverwrite = signal(false);
  readonly saving = signal(false);
  /** 「保存」を押したあとだけエラーを見せる */
  readonly submitted = signal(false);

  /** 入力欄は ContractFields（登録の段と同じ部品）。フォームはここで持つ */
  readonly form = this.fb.group(emptyContractForm(''));
  // ===== 契約書の PDF からの候補（入力欄には勝手に入れない。「反映」を押した項目だけ入れる） =====
  readonly pdfRead = signal<(ContractPdfRead & { fileName: string }) | null>(null);
  readonly pdfLoading = signal(false);
  readonly pdfError = signal<string | null>(null);
  /** 反映した候補（同じものを二度押さないように） */
  readonly applied = signal<ReadonlySet<ContractCandidate>>(new Set());

  /** 加入の基準（masterCriteria。null ＝ 読み込み中） */
  readonly criteriaRows = signal<CriteriaDoc[] | null>(null);

  /** 今日の被保険者区分と理由（契約・事業所の設定・基準から毎回計算。退職した人は出さない） */
  readonly classification = computed(() => {
    const office = this.context.current();
    const criteria = this.criteriaRows();
    const e = this.employee();
    if (!office || criteria === null || this.loading()) return null;
    if (e.retireDate && e.retireDate < this.today) return null;
    return classify(
      {
        birthDate: e.birthDate,
        optInDate: e.optInDate,
        optOutDate: e.optOutDate ?? null, // 11/9 より前のデータにはない
        contracts: this.rows(),
      },
      {
        standardHours: office.standardHours ?? null,
        specificApplication: office.specificApplication,
      },
      criteria,
      this.today,
    );
  });
  readonly insured = isInsured;
  readonly reasonParams = reasonParams;

  /** 今日に効いている契約（一覧で目立たせる） */
  readonly currentFrom = computed(() => contractAt(this.rows(), this.today)?.from ?? null);

  constructor() {
    // 始まる日を変えたら、上書きの確認はやり直し
    this.form.controls.from.valueChanges.subscribe(() => this.confirmingOverwrite.set(false));
  }

  ngOnInit(): void {
    this.load();
    this.criteriaApi
      .list()
      .then((rows) => this.criteriaRows.set(rows))
      .catch((err) => {
        console.error(err);
        this.criteriaRows.set([]); // 基準がないときは「判定できない（基準が未登録）」になる
      });
  }

  private get officeId(): string | null {
    return this.context.current()?.id ?? null;
  }

  private async load(): Promise<void> {
    const officeId = this.officeId;
    if (!officeId) return;
    this.loading.set(true);
    try {
      this.rows.set(await this.api.list(officeId, this.employee().id));
    } catch (err) {
      console.error(err);
      this.errorKey.set('contract.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  // ===== 表示の道具 =====

  /** 一覧の「時給・日給」の列 */
  unitWage(r: ContractDoc): string {
    if (r.hourlyWage != null) return `${formatYen(r.hourlyWage)}／h`;
    if (r.dailyWage != null) return `${formatYen(r.dailyWage)}／d`;
    return '—';
  }

  // ===== 追加・編集・削除 =====

  private open(v: ContractFormValue, key: 'new' | string): void {
    // 入力欄（ContractFields）は editing を開くたびに作り直すので、ここで値を入れておけば候補・開閉もそろう
    this.form.setValue(v, { emitEvent: false });
    this.submitted.set(false);
    this.confirmingOverwrite.set(false);
    this.errorKey.set(null);
    this.closePdf();
    this.editing.set(key);
  }

  /** 契約書の PDF を読んで候補を出す（PDF はどこにも保存しない） */
  async onPdf(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.closePdf();
    if (file.size > MAX_PDF_BYTES) {
      this.pdfError.set('importMap.error.tooBig');
      return;
    }
    this.pdfLoading.set(true);
    try {
      // pdf.js は大きいので、選んだときに初めて読み込む
      const { readPdfLines } = await import('../../../../shared/import/pdf');
      const read = readContractText(await readPdfLines(await file.arrayBuffer()));
      this.pdfRead.set({ ...read, fileName: file.name });
    } catch (err) {
      console.error(err);
      this.pdfError.set(err instanceof ImportFileError ? `importMap.error.${err.code}` : 'contract.pdf.error');
    } finally {
      this.pdfLoading.set(false);
    }
  }

  closePdf(): void {
    this.pdfRead.set(null);
    this.pdfError.set(null);
    this.applied.set(new Set());
  }

  /** 始まる日は、編集中（ドキュメントIDが決まっている）なら変えられない */
  canApply(c: ContractCandidate): boolean {
    return !(c.field === 'from' && this.form.controls.from.disabled);
  }

  apply(c: ContractCandidate): void {
    if (!this.canApply(c)) return;
    const patch = { [c.field]: c.value } as Partial<ContractFormValue>;
    // 時間は「週」の単位で入れる
    if (c.field === 'hours') patch.hoursUnit = 'week';
    this.form.patchValue(patch);
    this.applied.update((s) => new Set([...s, c]));
  }

  applyAll(): void {
    // 給与の形を先に（時給・日給の欄が出てから値を入れる）
    const list = [...(this.pdfRead()?.candidates ?? [])].sort(
      (a, b) => Number(b.field === 'payType') - Number(a.field === 'payType'),
    );
    for (const c of list) this.apply(c);
  }

  /** 候補の見せ方（選択肢は言葉に、時間・日付はそのまま） */
  candidateLabel(c: ContractCandidate): string | null {
    if (c.field === 'renewal') return `contract.renewal.${c.value}`;
    if (c.field === 'employmentType') return `contract.employmentType.${c.value}`;
    if (c.field === 'payType') return `contract.payType.${c.value}`;
    return null;
  }

  /** 最初の契約は入社日から。2つ目からは今の契約を写す（変わった所だけ直せばよい） */
  startAdd(): void {
    const latest = this.rows()[0]; // 新しい順
    this.form.controls.from.enable();
    this.open(
      latest ? nextContractForm(latest, '') : emptyContractForm(this.employee().hireDate),
      'new',
    );
  }

  startEdit(row: ContractDoc): void {
    this.open(toContractForm(row), row.from);
    this.form.controls.from.disable(); // 始まる日はドキュメントIDなので変えられない
  }

  cancel(): void {
    this.editing.set(null);
    this.closePdf();
  }

  async save(): Promise<void> {
    this.submitted.set(true);
    const v = this.form.getRawValue();
    const input = fromContractForm(v);
    const officeId = this.officeId;
    if (!input || !officeId) return;

    const isNew = this.editing() === 'new';
    const exists = this.rows().some((r) => r.from === input.from);
    if (isNew && exists && !this.confirmingOverwrite()) {
      this.confirmingOverwrite.set(true);
      return;
    }

    this.saving.set(true);
    this.errorKey.set(null);
    try {
      // 同じ始まる日の行があれば書き換え（作った日時は残す）
      if (isNew && !exists) await this.api.create(officeId, this.employee().id, input);
      else await this.api.update(officeId, this.employee().id, input);
      this.editing.set(null);
      this.closePdf();
      await this.load();
      this.changed.emit();
    } catch (err) {
      console.error(err);
      this.errorKey.set('contract.error.save');
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
      this.errorKey.set('contract.error.delete');
    } finally {
      this.saving.set(false);
    }
  }
}
