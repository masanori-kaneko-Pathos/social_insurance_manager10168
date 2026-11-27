import { OpenRow } from '../../../../shared/components/import-issues/open-row';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ImportPicker } from '../../../../shared/components/import-picker/import-picker';
import { ExportDialog } from '../../../../shared/components/export-dialog/export-dialog';
import { PayrollExportItem, payrollExportColumns } from '../../logic/payroll-export-columns';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { Payroll } from '../../../../core/models/payroll';
import { ColumnMapper } from '../../../../shared/components/column-mapper/column-mapper';
import { CsvEncoding, downloadCsv, safeFileName } from '../../../../shared/csv/csv';
import { IMPORT_ACCEPT, ImportFileError, readTables, SheetTable } from '../../../../shared/import/parse';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import {
  buildPayrollCsv,
  exportLineNames,
  lineColumnsOf,
  isOurPayrollFormat,
  mapHeader,
  payrollDerived,
  PAYROLL_COLUMNS,
  payrollExportRows,
  classifyImport,
  CsvLang,
  ImportItem,
  ImportRead,
  makeNameMatcher,
  PAYROLL_FIX,
  PAYROLL_HEADERS,
  payrollLabels,
  PAYROLL_TABLE_SPEC,
  payrollFileName,
  readPayrollCsv, PAYROLL_FIX_FIELDS, PAYROLL_IMPORT_FIELDS, scheduleFor, monthTotalsOf } from '../../logic/payroll-csv';
import { monthsBetween, shiftMonth, todayLocal } from '../../../../shared/utils/date';
import { latestPaidMonth } from '../../logic/payroll-rows';
import { payrollOf, premiumMonthOfPay } from '../../../office/office-settings';
import { applyRowValues, columnsForCodes, resolveHeader, rowRecord } from '../../../../shared/import/row-fix';
import { ImportFix, ImportIssue, ImportIssues } from '../../../../shared/components/import-issues/import-issues';
import { PartialSaveError, PayrollService } from '../../payroll.service';
import { PayrollItemService } from '../../payroll-item.service';
import { ContractService } from '../../../employees/contract.service';
import { contractAt } from '../../../employees/logic/contract-form-model';
import { ContractDoc } from '../../../../core/models/contract';
import { PAYROLL_ITEM_CATEGORIES, PayrollItem, PayrollItemCategory, PayrollItemInput } from '../../../../core/models/payroll-item';
import { guessMapping, normalizeNumber } from '../../../../shared/import/column-map';
import { categoryOf } from '../../logic/payroll-lines';
import { PaySchedule, periodOf } from '../../logic/payroll-rows';

import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { watchUnsaved } from '../../../../shared/services/unsaved-changes';
import { IssueRow } from '../../../../shared/components/import-issues/issue-row';
import { ImportSteps } from '../../../../shared/components/import-steps/import-steps';
import { PersonName } from '../../../../shared/components/person-name/person-name';
import { Pager } from '../../../../shared/components/pager/pager';
import { PAGE_SIZE, PageSize, pageOf } from '../../../../shared/logic/person-list';
import { payrollAt } from '../../../office/logic/pay-group';
import { YmPipe } from '../../../../shared/pipes/ym.pipe';
import { blockedLines, groupByPerson, PersonGroup } from '../../logic/import-groups';
import { numberKey } from '../../../../shared/import/number-match';
/** 書き出せる期間の上限（月数） */
const MAX_MONTHS = 24;
/** 確認画面に出すエラーの行数 */
const SHOW_ERRORS = 100;
/** CSV だけのエラー（それ以外は月の表と同じ payroll.rowError の文言を使う） */
const CSV_ERRORS = new Set([
  'noEmployeeNumber',
  'unknownEmployee',
  'ambiguousEmployee',
  'unknownName',
  'ambiguousName',
  'badMonth',
  'futureMonth',
  'badForMonth',
  'notEmployed',
  'duplicate',
  'badProrated',
  'badState',
  'linesMismatch',
  'noContractDays',
]);

interface Preview {
  fileName: string;
  encoding: CsvEncoding | null; // Excel・PDF は null
  read: ImportRead;
  created: ImportItem[];
  updated: ImportItem[];
  unchanged: ImportItem[];
}

@Component({
  selector: 'app-payroll-import',
  imports: [OpenRow, YmPipe, PersonName, Pager, IssueRow, ImportSteps, ImportPicker, ColumnMapper, ExportDialog, HalfWidthDigits, ImportIssues, RouterLink, TranslocoPipe, FormsModule],
  templateUrl: './payroll-import.html',
  styleUrl: './payroll-import.css',
})
export class PayrollImport {
  private readonly employeesApi = inject(EmployeeService);
  private readonly payrollApi = inject(PayrollService);
  private readonly transloco = inject(TranslocoService);
  readonly context = inject(OfficeContext);

  readonly showErrors = SHOW_ERRORS;
  /** 確認の表は、ほかの一覧と同じページ送りで100行ずつ（前は20行だけ出して「ほか◯件」にしていた。11/19） */
  readonly page = signal(1);
  readonly pageSize = signal<PageSize>(PAGE_SIZE);
  readonly pageOf = pageOf;

  private employees: Employee[] = [];
  /** 表の氏名にフリガナを付けるため（読んだ従業員を ID で引く。11/18） */
  private employeeMap: { from: Employee[]; map: Map<string, Employee> } | null = null;
  employeeOf(id: string): Employee | null {
    if (this.employeeMap?.from !== this.employees) this.employeeMap = { from: this.employees, map: new Map(this.employees.map((e) => [e.id, e])) };
    return this.employeeMap.map.get(id) ?? null;
  }
  private saved = new Map<string, Payroll>(); // 'employeeId|paidMonth' → 保存済み（読んだ月の分だけ）
  /** 保存済みの実績をもう読んだ月（全部は読まず、出力する月・ファイルにある月だけ読む。11/16） */
  private loadedMonths = new Set<string>();

  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);

  // ----- 書き出し -----
  readonly latest = computed(() => {
    const office = this.context.current();
    return office ? latestPaidMonth(todayLocal(), payrollOf(office)) : '';
  });
  from = '';
  to = '';
  readonly exportErrorKey = signal<string | null>(null);

  // ----- 取り込み -----
  readonly preview = signal<Preview | null>(null);
  readonly accept = IMPORT_ACCEPT;
  /**
   * 列を合わせる画面の決まり。給与の項目名に当たる見出しの列（基本給・非課税通勤手当など）は、
   * 項目に結ばなくても後ろに付けて残し、内訳として読む（11/24）
   */
  readonly tableSpec = computed(() => ({
    ...PAYROLL_TABLE_SPEC,
    passThrough: (h: string) => categoryOf(h.trim(), this.allItems()) !== null,
    // 明細の内訳の列があれば、通貨によるものの額・うち固定的賃金は選ばずに内訳から計算して見せる（11/25）
    derived: (headers: readonly string[]) => payrollDerived(headers, this.allItems()),
  }));
  /** 給与の項目と、内訳のひな形（内訳の列を見分ける・書き出す。11/24） */
  readonly payrollItems = signal<PayrollItem[]>([]);

  // ----- 分類が決まっていない列（11/27） -----
  // 給与の項目にない見出しの数の列（「通勤手当（日額）」「調整手当」など）は、前は黙って読み飛ばしていた。
  // そのせいで内訳の合計が総支給額と合わず、的外れなエラーになっていた。取り込む前に分類を選んでもらう
  readonly categories = PAYROLL_ITEM_CATEGORIES;
  /** この取り込みで分類を選んだ列（取り込んだら事業所の給与の項目にも登録する） */
  readonly extraItems = signal<PayrollItemInput[]>([]);
  /** 「使わない」にした列 */
  readonly skippedCols = signal<ReadonlySet<string>>(new Set());
  /** 事業所の項目と、この取り込みで選んだ分類 */
  readonly allItems = computed<PayrollItemInput[]>(() => [...this.payrollItems(), ...this.extraItems()]);
  /** 選んでいる途中の分類（見出し → 分類。'skip' は使わない） */
  readonly pendingChoice = signal<Record<string, PayrollItemCategory | 'skip'>>({});

  /** 読んだファイルの、分類が決まっていない数の列の見出し */
  readonly unknownCols = computed<string[]>(() => {
    const file = this.loaded();
    const header = file?.tables[0]?.rows[0];
    if (!file || !header) return [];
    const rows = file.tables[0].rows.slice(1);
    const known = new Set<number>(Object.values(mapHeader(header).index) as number[]);
    for (const m of Object.values(guessMapping(header, PAYROLL_IMPORT_FIELDS))) {
      const col = (m as { col?: number } | undefined)?.col;
      if (col !== undefined) known.add(col);
    }
    const items = this.allItems();
    const skipped = this.skippedCols();
    const out: string[] = [];
    header.forEach((h, j) => {
      const name = (h ?? '').trim();
      if (!name || known.has(j) || skipped.has(name) || categoryOf(name, items) !== null) return;
      const values = rows.map((r) => normalizeNumber(r[j] ?? '')).filter((v) => v !== '');
      if (values.length > 0 && values.every((v) => /^-?\d+(\.\d+)?$/.test(v))) out.push(name);
    });
    return out;
  });

  setChoice(col: string, v: string): void {
    this.pendingChoice.update((c) => ({ ...c, [col]: v as PayrollItemCategory | 'skip' }));
  }

  /** 選んだ分類で読み直す */
  applyChoices(): void {
    const c = this.pendingChoice();
    const add: PayrollItemInput[] = [];
    const skip = new Set(this.skippedCols());
    for (const col of this.unknownCols()) {
      const v = c[col];
      if (!v) continue;
      if (v === 'skip') skip.add(col);
      else add.push({ name: col, labels: [], category: v });
    }
    this.extraItems.update((x) => [...x, ...add]);
    this.skippedCols.set(skip);
    this.pendingChoice.set({});
    if (this.lastTable) void this.showPreview(this.lastTable);
  }

  readonly allChosen = computed(() => this.unknownCols().every((c) => !!this.pendingChoice()[c]));
  private template: string[] | null = null;
  /** 従業員ごとの契約（内訳の列があるファイルのときだけ読む。基本給を固定的賃金に数えるか） */
  private contracts: Map<string, ContractDoc[]> | null = null;
  private readonly itemsApi = inject(PayrollItemService);
  private readonly contractsApi = inject(ContractService);
  /** 読んだファイル。見出しがうちと違えば「列を合わせる」画面を出す（mapping が true の間） */
  readonly loaded = signal<{ fileName: string; encoding: CsvEncoding | null; tables: SheetTable[] } | null>(null);
  readonly mapping = signal(false);
  readonly saving = signal(false);
  readonly progress = signal<{ done: number; total: number } | null>(null);
  readonly doneCount = signal<number | null>(null);
  /** 読んだのにまだ取り込んでいなければ、画面を離れる前に確かめる（11/17） */
  private readonly unsaved = watchUnsaved(() => (this.loaded() !== null || this.preview() !== null) && this.doneCount() === null);
  /** 取り込んだいちばん新しい支払月（次の一歩のリンク用。11/16） */
  readonly doneMonth = signal<string | null>(null);
  readonly partial = signal<{ done: number; total: number } | null>(null);

  /** 表に出す行（新規・上書き） */
  readonly allWrites = computed(() => {
    const p = this.preview();
    return p ? [...p.created, ...p.updated] : [];
  });

  // ===== 行ごとのチェック（11/17）：外した行は取り込まない =====
  private readonly fixRef = viewChild(ImportIssues);
  private kept(line: number): boolean {
    return !(this.fixRef()?.excluded().has(line) ?? false);
  }
  /** 取り込む行（チェックの入った行。エラーのある人の行は、ImportIssues の blocked で外れる） */
  readonly writes = computed(() => this.allWrites().filter((it) => this.kept(it.line)));

  // ===== 人でくくる（11/28）：確認の表を1人1行にして、押すとその人の月が開く =====
  /**
   * エラーの行がある人の、エラーでない行。その人の月は全部取り込まない
   * （月が欠けると、定時決定・随時改定の平均が正しく出ないため。11/28 本人の決定）
   */
  readonly blocked = computed(() => {
    const p = this.preview();
    return p ? blockedLines(this.allWrites(), p.read.errors.map((e) => e.employeeId)) : new Set<number>();
  });

  /** 表の人の行（エラーのある人が上、そのあとは社員番号の順） */
  readonly groups = computed<PersonGroup<ImportItem, ImportIssue>[]>(() => {
    const fix = this.fixRef();
    const p = this.preview();
    const table = this.table();
    if (!fix || !p || !table) return [];
    const errors = new Map(p.read.errors.map((e) => [e.line, e]));
    const updated = new Set(p.updated);
    const noH = this.headerOf('employeeNumber');
    const nameH = this.headerOf('name');
    const groups = groupByPerson(
      fix.withIssues(this.allWrites()),
      (line) => {
        const e = errors.get(line);
        const rec = rowRecord(table, line);
        const fileKey = numberKey(rec[noH] ?? '') || (rec[nameH] ?? '').normalize('NFKC').replace(/\s+/g, '');
        return { employeeId: e?.employeeId ?? null, fileKey, paidMonth: e?.paidMonth ?? null };
      },
      (it) => updated.has(it),
      (id) => this.employeeOf(id)?.employeeNumber ?? '',
    );
    // エラーの行を隠すときは、エラーのある人ごと隠す（その人の月は取り込まないため。11/28）
    const blocked = this.blocked();
    return fix.hideIssues() ? groups.filter((g) => !g.lines.some((l) => blocked.has(l))) : groups;
  });
  /** 分類の例（分類が決まっていない列の箱で、決め方の目安に出す。11/28） */
  readonly categoryExamples = PAYROLL_ITEM_CATEGORIES;

  /** 人が決まらない行の、ファイルに書いてあった社員番号と氏名 */
  fileLabel(g: PersonGroup<ImportItem, ImportIssue>): string {
    const table = this.table();
    if (!table) return g.fileKey;
    const rec = rowRecord(table, g.lines[0]);
    return [rec[this.headerOf('employeeNumber')], rec[this.headerOf('name')]].map((v) => (v ?? '').trim()).filter(Boolean).join(' ') || '—';
  }

  /** 開いている人の行 */
  readonly opened = signal<ReadonlySet<string>>(new Set());
  toggleOpen(key: string): void {
    const next = new Set(this.opened());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.opened.set(next);
  }
  onGroupClick(event: MouseEvent, key: string): void {
    const el = event.target as HTMLElement | null;
    if (el?.closest('a, button, input, select, textarea, label')) return;
    if (window.getSelection()?.toString()) return;
    this.toggleOpen(key);
  }
  onGroupKey(event: KeyboardEvent, key: string): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.toggleOpen(key);
  }

  /** 人の行のチェック：その人の行が全部入っているか（エラーのある人は入らない） */
  groupKept(fix: ImportIssues, g: PersonGroup<ImportItem, ImportIssue>): boolean {
    return g.errors === 0 && g.lines.every((l) => fix.kept(l));
  }
  readonly createdCount = computed(() => {
    const created = new Set(this.preview()?.created ?? []);
    return this.writes().filter((it) => created.has(it)).length;
  });
  readonly updatedCount = computed(() => this.writes().length - this.createdCount());
  /** ファイルの支払月ごとの人数と、通貨によるものの額の合計（給与ソフトの支給総額と見比べる。11/26） */
  readonly monthTotals = computed(() => {
    const p = this.preview();
    return p ? monthTotalsOf([...p.created, ...p.updated, ...p.unchanged]) : [];
  });
  monthParts(m: string): { y: string; m: number } {
    return { y: m.slice(0, 4), m: Number(m.slice(5)) };
  }

  readonly canImport = computed(() => {
    const p = this.preview();
    return (
      !!p &&
      this.context.isAdmin() &&
      p.read.missingColumns.length === 0 &&
      (p.read.errors.length === 0 || this.skipErrors()) &&
      this.unknownCols().length === 0 &&
      this.writes().length > 0 &&
      !this.saving()
    );
  });
  readonly headersJa = Object.values(PAYROLL_HEADERS.ja).join('・');

  constructor() {
    this.from = this.latest();
    this.to = this.latest();
    this.load();
  }

  private async load(): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    this.loading.set(true);
    try {
      this.employees = await this.employeesApi.list(office.id);
      // 給与の項目・ひな形は、読めなくても取り込める（よくある名前だけで内訳の列を見分ける）
      await Promise.all([
        this.itemsApi.list(office.id).then((x) => this.payrollItems.set(x)).catch((err) => console.error(err)),
        this.itemsApi.template(office.id).then((t) => (this.template = t)).catch((err) => console.error(err)),
      ]);
      // 保存済みの実績は、ここでは読まない（使う月が決まってから ensureMonths で読む）
      this.saved = new Map();
      this.loadedMonths = new Set();
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'payrollCsv.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  /** 保存済みの実績を、まだ読んでいない月の分だけ読む */
  private async ensureMonths(officeId: string, months: readonly string[]): Promise<void> {
    const missing = [...new Set(months)].filter((m) => !this.loadedMonths.has(m));
    if (missing.length === 0) return;
    const payrolls = await this.payrollApi.listOfOfficeMonths(
      officeId,
      this.employees.map((e) => e.id),
      missing,
    );
    for (const p of payrolls) this.saved.set(`${p.employeeId}|${p.paidMonth}`, p);
    for (const m of missing) this.loadedMonths.add(m);
  }

  private lang(): CsvLang {
    return this.transloco.getActiveLang() === 'en' ? 'en' : 'ja';
  }

  // ===== 書き出し =====

  /** 選んだ期間の月を読む（期間がおかしい・読めないときは知らせて null） */
  private async exportMonths(officeId: string): Promise<string[] | null> {
    this.exportErrorKey.set(null);
    if (!this.from || !this.to || this.from > this.to) {
      this.exportErrorKey.set('payrollCsv.error.range');
      return null;
    }
    const months = monthsBetween(this.from, this.to);
    if (months.length > MAX_MONTHS) {
      this.exportErrorKey.set('payrollCsv.error.tooLong');
      return null;
    }
    try {
      await this.ensureMonths(officeId, months);
    } catch (err) {
      console.error(err);
      this.exportErrorKey.set(errorKeyOf(err, 'payrollCsv.error.load'));
      return null;
    }
    return months;
  }

  async exportCsv(): Promise<void> {
    const office = this.context.current();
    if (!office || !this.context.isAdmin()) return;
    const months = await this.exportMonths(office.id);
    if (!months) return;
    const lang = this.lang();
    // 内訳の列（ひな形の順 → 保存済みの内訳に出てくる順）も付ける。そのまま取り込めば内訳ごと戻る（11/24）
    const saved = [...this.saved.values()];
    const rows = buildPayrollCsv(this.employees, saved, months, this.scheduleOf(office), lang, exportLineNames(saved, this.template));
    downloadCsv(safeFileName(payrollFileName(office.name, this.from, this.to, todayLocal(), lang)), rows);
  }

  // ===== 項目を選んで出力（11/24） =====
  private readonly exportDialog = viewChild(ExportDialog);
  readonly exportDefaultKeys = PAYROLL_COLUMNS;
  /** 窓に渡す行（開くときに、選んだ期間で作る） */
  readonly exportItems = signal<PayrollExportItem[]>([]);
  readonly exportStem = signal('');
  readonly exportScope = signal('');
  /** 見出しは取り込みと同じ言葉（言語は窓を開いたとき） */
  readonly exportCatalog = signal(payrollExportColumns({ lang: 'ja', t: (k) => k, deptName: () => '' }));

  async openExport(): Promise<void> {
    const office = this.context.current();
    if (!office || !this.context.isAdmin()) return;
    const months = await this.exportMonths(office.id);
    if (!months) return;
    const lang = this.lang();
    const items = payrollExportRows(this.employees, [...this.saved.values()], months, this.scheduleOf(office));
    this.exportCatalog.set(
      payrollExportColumns({
        lang,
        t: (k) => this.transloco.translate(k),
        deptName: (id) => office.departments?.find((d) => d.id === id)?.name ?? '',
      }),
    );
    this.exportItems.set(items);
    this.exportStem.set(payrollFileName(office.name, this.from, this.to, todayLocal(), lang).replace(/\.csv$/, ''));
    const range = this.from === this.to ? this.from : `${this.from}〜${this.to}`;
    this.exportScope.set(this.transloco.translate('exportDialog.scopePayroll', { range, n: items.length }));
    void this.exportDialog()?.open();
  }

  /** 期間を「前の3か月」などにすばやく合わせる */
  setRange(months: number): void {
    this.to = this.latest();
    this.from = shiftMonth(this.latest(), -(months - 1));
  }

  // ===== 取り込み =====

  async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // 同じファイルを選び直しても反応するように
    if (!file) return;
    this.reset();
    try {
      const { tables, encoding } = await readTables(file);
      this.loaded.set({ fileName: file.name, encoding, tables });
      const [first] = tables;
      // うちの書き出しのままなら、今までどおり確認画面へ（見出しは日本語・英語のどちらでも）。PDF はいつも列を合わせる
      // 内訳の列（基本給・通勤手当など）があるファイルは、通貨によるものの額・うち固定的賃金の列がなくてもうちの形（11/25）
      const ours = isOurPayrollFormat(first.rows[0], this.allItems());
      if (tables.length === 1 && !first.pdf && ours) this.showPreview(first.rows);
      else this.mapping.set(true);
    } catch (err) {
      console.error(err);
      this.errorKey.set(
        err instanceof ImportFileError ? `importMap.error.${err.code}` : 'payrollCsv.error.read',
      );
    }
  }

  /** 列を合わせ終わった（うちの見出しの表になった） */
  onMapped(table: string[][]): void {
    this.mapping.set(false);
    this.showPreview(table);
  }

  /** 列の対応をやり直す（確認画面から戻る） */
  remap(): void {
    this.preview.set(null);
    this.mapping.set(true);
  }

  private reset(): void {
    this.loaded.set(null);
    this.mapping.set(false);
    this.preview.set(null);
    this.doneCount.set(null);
    this.doneMonth.set(null);
    this.partial.set(null);
    this.errorKey.set(null);
    this.inKindMissing.set('zero');
    this.lastTable = null;
    this.table.set(null);
    this.skipErrors.set(true);
    this.extraItems.set([]);
    this.skippedCols.set(new Set());
    this.pendingChoice.set({});
    this.opened.set(new Set());
  }

  // ===== エラーの直し方（11/17。共通の部品 app-import-issues）：窓で1行ずつ直して、すぐ確かめ直す =====
  readonly skipErrors = signal(true); // 問題の行は、行のチェックが外れて取り込まない（11/17）
  /** いま確認画面に出している表（部品に渡す） */
  readonly table = signal<string[][] | null>(null);

  /** 表の見出しのうち、その列の書き方（日本語・英語のどちらのファイルでも） */
  private headerOf(column: string): string {
    return resolveHeader(this.table()?.[0] ?? [], payrollLabels(column));
  }

  readonly summaryHeaders = computed(() => ['employeeNumber', 'name', 'paidMonth'].map((c) => this.headerOf(c)));
  readonly keyHeader = computed(() => this.headerOf('employeeNumber'));
  /** 問題の行：表の列ごとに、ファイルのどの列の値を出すか（取り込んだときと同じ並び。11/17） */
  readonly issueCols = computed<readonly (readonly string[])[]>(() => [
    [this.headerOf('employeeNumber'), this.headerOf('name')],
    [this.headerOf('paidMonth')],
    [this.headerOf('cash')],
    [this.headerOf('fixed')],
    [this.headerOf('days')],
    [],
  ]);
  /** 窓で直すときの欄の種類（11/17） */
  readonly fixFields = PAYROLL_FIX_FIELDS;

  readonly issues = computed<ImportIssue[]>(() => {
    const p = this.preview();
    const table = this.table();
    if (!p || !table) return [];
    const byName = makeNameMatcher(this.employees);
    return p.read.errors.map((e) => {
      const messages = this.errorKeys(e.codes).map((k) => this.transloco.translate(k));
      const suggestions: NonNullable<ImportIssue['suggestions']> = [];
      // いない社員番号：氏名から見つかれば「この人では？」、見つからなければ次にすることを書く
      if (e.codes.some((c) => c === 'unknownEmployee' || c === 'unknownName')) {
        const name = rowRecord(table, e.line)[this.headerOf('name')] ?? '';
        const m = name ? byName(name) : { kind: 'none' as const };
        if (m.kind === 'ok' && m.employee.employeeNumber) {
          suggestions.push({
            label: this.transloco.translate('importFix.byName', { name: `${m.employee.lastName} ${m.employee.firstName}`, n: m.employee.employeeNumber }),
            values: { [this.headerOf('employeeNumber')]: m.employee.employeeNumber },
          });
        } else {
          messages.push(this.transloco.translate('importFix.unknownEmployee'));
        }
      }
      return { line: e.line, messages, headers: columnsForCodes(e.codes, PAYROLL_FIX).map((c) => this.headerOf(c)), suggestions };
    });
  });

  onFix(fix: ImportFix): void {
    const table = this.table();
    if (!table) return;
    this.showPreview(applyRowValues(table, fix.line, fix.values));
  }

  /** うちの見出しの表 → 読み取り（今までの確認画面） */
  /** 現物の列がないファイルの扱い（初期値は「現物はない」） */
  readonly inKindMissing = signal<'zero' | 'merged'>('zero');
  /** いま確認画面に出している表（現物の扱いを変えたら読み直す） */
  private lastTable: string[][] | null = null;

  setInKindMissing(v: 'zero' | 'merged'): void {
    this.inKindMissing.set(v);
    if (this.lastTable) this.showPreview(this.lastTable);
  }

  private async showPreview(table: string[][]): Promise<void> {
    this.lastTable = table;
    this.table.set(table);
    const office = this.context.current();
    const file = this.loaded();
    if (!office || !file) return;
    try {
      // 内訳の列があるファイル・給与計算の基礎日数を給与の形から出すファイル：給与の形を見るため、契約を読む（1回だけ。11/25）
      const needsContracts =
        table.length > 0 &&
        (lineColumnsOf(table[0], new Set(), this.allItems()).length > 0 ||
          mapHeader(table[0]).index.days === undefined ||
          table.slice(1).some((r) => (r[mapHeader(table[0]).index.days!] ?? '').trim() === ''));
      if (needsContracts && !this.contracts) {
        const lists = await Promise.all(this.employees.map((e) => this.contractsApi.list(office.id, e.id).catch(() => [])));
        this.contracts = new Map(this.employees.map((e, i) => [e.id, lists[i]]));
      }
      // 対象期間は、人と支払月ごとの給与の支払区分で出す（11/24）
      const schedule = this.scheduleOf(office);
      const read = readPayrollCsv(table, this.employees, schedule, {
        inKindMissing: this.inKindMissing(),
        today: todayLocal(),
        items: this.allItems(),
        payTypeOf: (id, month) => contractAt(this.contracts?.get(id) ?? [], periodOf(month, scheduleFor(schedule, id, month)).end)?.payType ?? null,
        scheduledDaysOf: (id, month) =>
          contractAt(this.contracts?.get(id) ?? [], periodOf(month, scheduleFor(schedule, id, month)).end)?.monthlyDays ?? null,
      });
      // 「新規・上書き・変わらない」を数えるために、ファイルにある月の保存済みの実績だけ読む
      try {
        await this.ensureMonths(
          office.id,
          read.items.map((it) => it.paidMonth),
        );
      } catch (err) {
        console.error(err);
        this.errorKey.set(errorKeyOf(err, 'payrollCsv.error.load'));
        return;
      }
      if (this.lastTable !== table) return; // 読んでいる間に別のファイルに変わった
      this.preview.set({ fileName: file.fileName, encoding: file.encoding, read, ...classifyImport(read.items, this.saved) });
      this.page.set(1);
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'payrollCsv.error.read'));
    }
  }

  clear(): void {
    this.reset();
  }

  async importCsv(): Promise<void> {
    const office = this.context.current();
    if (!office || !this.canImport()) return;
    const writes = this.writes().map((it) => ({
      employeeId: it.employeeId,
      paidMonth: it.paidMonth,
      input: it.input,
      exists: this.saved.has(`${it.employeeId}|${it.paidMonth}`),
      before: this.saved.get(`${it.employeeId}|${it.paidMonth}`) ?? null,
    }));
    this.saving.set(true);
    this.progress.set({ done: 0, total: writes.length });
    try {
      // この取り込みで分類を選んだ列は、事業所の給与の項目にも登録する（次の取り込み・入力で同じ分類になるように）
      const extras = this.extraItems();
      await this.payrollApi.saveMany(office.id, writes, (done) =>
        this.progress.set({ done, total: writes.length }),
      );
      for (const it of extras) await this.itemsApi.create(office.id, it).catch((err) => console.error(err));
      this.reset();
      this.doneCount.set(writes.length);
      this.doneMonth.set(writes.reduce<string | null>((m, w) => (m === null || w.paidMonth > m ? w.paidMonth : m), null));
    } catch (err) {
      console.error(err);
      if (err instanceof PartialSaveError && err.done > 0) {
        this.partial.set({ done: err.done, total: writes.length });
      } else {
        this.errorKey.set('payrollCsv.error.save');
      }
    } finally {
      this.saving.set(false);
      this.progress.set(null);
      await this.load(); // 次の取り込みで「新規・上書き」を正しく数えるため
    }
  }

  /** エラーの行の文言（キーの配列） */
  errorKeys(codes: readonly string[]): string[] {
    return codes.map((c) => (CSV_ERRORS.has(c) ? `payrollCsv.rowError.${c}` : `payroll.rowError.${c}`));
  }

  readonly yen = (n: number) => n.toLocaleString('ja-JP');

  /** その月に払う給与から控除するのは何月分の保険料か（事業所の控除方法による） */
  premiumMonth(paidMonth: string): string {
    const office = this.context.current();
    return office ? premiumMonthOfPay(paidMonth, payrollOf(office), office.deductionHistory) : paidMonth;
  }

  /** '2026-11' → 11月 */
  monthLabel(ym: string): number {
    return Number(ym.slice(5, 7));
  }

  /** その人のその支払月の給与の支払区分（締め日・支払月）。11/24 */
  private scheduleOf(office: Parameters<typeof payrollAt>[0]): (employeeId: string, paidMonth: string) => PaySchedule {
    const byId = new Map(this.employees.map((e) => [e.id, e]));
    return (id, month) => payrollAt(office, byId.get(id), month);
  }
}
