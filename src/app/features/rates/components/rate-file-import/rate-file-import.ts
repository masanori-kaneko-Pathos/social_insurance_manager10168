import { Component, computed, effect, ElementRef, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { KumiaiRateInput, MonthRange, RateMicro, RateSplit } from '../../../../core/models/rates';
import { ImportFix, ImportIssue, ImportIssues } from '../../../../shared/components/import-issues/import-issues';
import { ImportFileError, MAX_FILE_BYTES, readTables } from '../../../../shared/import/parse';
import {
  CHILD_SUPPORT_START,
  RATE_CSV_HEADERS,
  RATE_FIX_FIELDS,
  RateCsvColumn,
  RateCsvRow,
  RateCsvStatus,
  rateEditsOf,
  rateErrorColumns,
  rateFixTable,
  rateCsvTable,
  readRateFile,
  recheckRateCsv,
} from '../../logic/rate-csv';
import { formatRate, RateUnit } from '../../logic/rate-format';
import { inRange } from '../../logic/rate-changes';
import { IssueRow } from '../../../../shared/components/import-issues/issue-row';

type Kind = 'health' | 'care' | 'childSupport';

/**
 * 組合の料率のファイルの読み込み（11/17。事業所の設定と料率の窓で共通）
 * - ほかの取り込みと同じ並び：ファイルを選ぶ → ファイル名と「やめる」 → 件数 → 問題の一覧（窓で直す） → 中身の表
 * - 保存は親がする（事業所の設定は「保存」のとき、料率の窓は「取り込む」のボタン。ボタンは <ng-content> で差し込む）
 * - 期間（range）や保存済み（existing）が変わったら、読んだ行を確かめ直す（切り替える月を変えたときなど）
 */
@Component({
  selector: 'app-rate-file-import',
  imports: [IssueRow, ImportIssues, TranslocoPipe],
  templateUrl: './rate-file-import.html',
  styleUrl: './rate-file-import.css',
})
export class RateFileImport {
  /** この組合の期間（外の月はエラー） */
  readonly range = input.required<MonthRange>();
  /** 保存済みの料率（同じ月は「上書き」「変わらない」になる） */
  readonly existing = input<readonly KumiaiRateInput[]>([]);
  /** PDF も受け付けるか（受け付けたら pdf で親に渡す。親が手で入れる欄に入れる） */
  readonly acceptPdf = input(false);
  /** 表示の単位 */
  readonly unit = input<RateUnit>('percent');
  readonly busy = input(false);
  /** 件数のあとに出す一言（例：保存のときに登録します） */
  readonly noteKey = input<string | null>(null);

  readonly pdf = output<File>();

  private readonly transloco = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly kinds: readonly Kind[] = ['health', 'care', 'childSupport'];

  readonly fileName = signal<string | null>(null);
  readonly rows = signal<RateCsvRow[]>([]);
  readonly missing = signal<string[]>([]);
  readonly fromTable = signal(false);
  readonly errorKey = signal<string | null>(null);
  /** エラーの行を除いて取り込むか */
  readonly skip = signal(true); // 問題の行は、行のチェックが外れて取り込まない（11/17）
  /** 保存を押したのに、エラーの行が残っている */
  readonly blockedShown = signal(false);

  readonly loaded = computed(() => this.fileName() !== null);
  /** ほかの事業所から写したとき、この組合の期間の外で除いた件数 */
  readonly outside = signal(0);

  readonly count = computed(() => {
    const c: Record<RateCsvStatus, number> = { new: 0, update: 0, same: 0, error: 0 };
    for (const r of this.rows()) c[r.status]++;
    return c;
  });

  /** 件数の一文（0件の区分は出さない） */
  readonly countText = computed(() => {
    const c = this.count();
    return (['new', 'update', 'same', 'error'] as const)
      .filter((s) => c[s] > 0)
      .map((s) => this.transloco.translate(`rateImport.count.${s}`, { n: c[s] }))
      .join('・');
  });

  /** 保存する料率（新規・上書き） */
  // ===== 行ごとのチェック（11/17）：外した行は取り込まない =====
  private readonly fixRef = viewChild(ImportIssues);
  private kept(line: number): boolean {
    return !(this.fixRef()?.excluded().has(line) ?? false);
  }

  readonly toSave = computed(() =>
    this.rows()
      .filter((r) => (r.status === 'new' || r.status === 'update') && r.input && this.kept(r.line))
      .map((r) => ({ input: r.input!, exists: r.status === 'update' })),
  );

  /** エラーの行が残っていて、除いて取り込むにもしていない */
  readonly blocked = computed(() => this.count().error > 0 && !this.skip());

  // ----- 共通の窓（app-import-issues）に渡すもの -----
  readonly fixTable = computed(() => rateFixTable(this.rows()));
  readonly fromHeader = RATE_CSV_HEADERS.from;
  /** 窓で直すときの欄の種類（11/17） */
  readonly fixFields = RATE_FIX_FIELDS;
  readonly issues = computed<ImportIssue[]>(() =>
    this.rows()
      .filter((r) => r.status === 'error')
      .map((r) => ({
        line: r.line,
        messages: r.errors.map((e) => this.transloco.translate(this.errorKeyOf(e))),
        headers: rateErrorColumns(r.errors).map((c: RateCsvColumn) => RATE_CSV_HEADERS[c]),
      })),
  );

  constructor() {
    // 期間・保存済みが変わったら、読んだ行を確かめ直す
    effect(() => {
      const ctx = { range: this.range(), existing: this.existing() };
      untracked(() => {
        if (this.rows().length === 0) return;
        this.rows.set(recheckRateCsv(this.rows(), new Map(), ctx).rows);
      });
    });
    effect(() => {
      if (!this.blocked()) untracked(() => this.blockedShown.set(false));
    });
  }

  async onFile(event: Event): Promise<void> {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    this.clear();
    if (/\.pdf$/i.test(file.name)) {
      if (this.acceptPdf()) this.pdf.emit(file);
      return;
    }
    try {
      if (file.size > MAX_FILE_BYTES) throw new ImportFileError('tooBig');
      const { tables } = await readTables(file);
      const result = readRateFile(tables[0].rows, { range: this.range(), existing: this.existing() });
      this.fromTable.set(result.fromTable);
      this.missing.set(result.missing.map((c) => RATE_CSV_HEADERS[c]));
      this.rows.set(result.rows);
      this.fileName.set(file.name);
    } catch (err) {
      console.error(err);
      this.errorKey.set(err instanceof ImportFileError ? `importMap.error.${err.code}` : 'rateDialog.csv.readError');
    }
  }

  /**
   * ほかの事業所の料率を、ファイルを読み込んだときと同じ確認の表に並べる（同じ組合の料率を写す。11/26）
   * label はファイル名の場所に出す名前（例：「大阪支店の料率」）
   */
  loadRates(rates: readonly KumiaiRateInput[], label: string): void {
    this.clear();
    // この事業所が組合に入っている期間の月だけ（外の月はエラーの行にせず、件数だけ知らせる）
    const inside = rates.filter((r) => inRange(r.from, this.range()));
    this.outside.set(rates.length - inside.length);
    if (inside.length === 0) {
      this.errorKey.set('rateImport.share.empty');
      return;
    }
    const result = readRateFile(rateCsvTable(inside, 'percent'), { range: this.range(), existing: this.existing() });
    this.rows.set(result.rows);
    this.fileName.set(label);
  }

  /** 窓で直した1行で、確かめ直す */
  onFix(fix: ImportFix): void {
    const edits = new Map([[fix.line, rateEditsOf(fix.values)]]);
    this.rows.set(recheckRateCsv(this.rows(), edits, { range: this.range(), existing: this.existing() }).rows);
  }

  clear(): void {
    this.fileName.set(null);
    this.rows.set([]);
    this.missing.set([]);
    this.fromTable.set(false);
    this.errorKey.set(null);
    this.outside.set(0);
    this.skip.set(true);
    this.blockedShown.set(false);
  }

  /** 親が保存を押したのに、エラーの行が残っているとき：知らせて、ここまで動かす */
  showBlocked(): void {
    this.blockedShown.set(true);
    this.host.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ----- 表示 -----

  errorKeyOf(code: string): string {
    return `rateDialog.csv.error.${code.replace('.', '_')}`;
  }

  /** 支援金は2026年4月分から。それより前は 0% でなく「—（施行前）」 */
  notYet(kind: Kind, month: string): boolean {
    return kind === 'childSupport' && /^\d{4}-\d{2}$/.test(month) && month < CHILD_SUPPORT_START;
  }

  show(rate: RateMicro): string {
    return formatRate(rate, this.unit());
  }

  totalOf(s: RateSplit): RateMicro {
    return s.employee + s.employer;
  }

  /** 読めなかった行は、ファイルに書いてあった値をそのまま出す */
  raw(r: RateCsvRow, kind: Kind): { total: string; employee: string; employer: string } {
    const v = r.values;
    return { total: v[`${kind}_total`], employee: v[`${kind}_employee`], employer: v[`${kind}_employer`] };
  }
}
