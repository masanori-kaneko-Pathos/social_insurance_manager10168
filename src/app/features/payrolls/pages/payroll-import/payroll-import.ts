import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { Payroll } from '../../../../core/models/payroll';
import { ColumnMapper } from '../../../../shared/components/column-mapper/column-mapper';
import { CsvEncoding, downloadCsv, safeFileName } from '../../../../shared/csv/csv';
import { isOurFormat } from '../../../../shared/import/column-map';
import { IMPORT_ACCEPT, ImportFileError, readTables, SheetTable } from '../../../../shared/import/parse';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import {
  buildPayrollCsv,
  classifyImport,
  CsvLang,
  ImportItem,
  ImportRead,
  PAYROLL_FIX,
  PAYROLL_HEADERS,
  PAYROLL_IMPORT_FIELDS,
  payrollLabels,
  PAYROLL_TABLE_SPEC,
  payrollFileName,
  readPayrollCsv,
} from '../../logic/payroll-csv';
import { monthsBetween, shiftMonth, todayLocal } from '../../../../shared/utils/date';
import { latestPaidMonth } from '../../logic/payroll-rows';
import { payrollOf, premiumMonthOfPay } from '../../../office/office-settings';
import { applyCellEdits, cellKey, cellOf, columnsForCodes, errorRowsTable } from '../../../../shared/import/row-fix';
import { PartialSaveError, PayrollService } from '../../payroll.service';

import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
import { errorKeyOf } from '../../../../shared/utils/error-key';
/** 書き出せる期間の上限（月数） */
const MAX_MONTHS = 24;
/** 確認画面に出すエラーの行数 */
const SHOW_ERRORS = 100;
/** 確認画面に出す取り込む行の数 */
const SHOW_ITEMS = 20;
/** CSV だけのエラー（それ以外は月の表と同じ payroll.rowError の文言を使う） */
const CSV_ERRORS = new Set([
  'noEmployeeNumber',
  'unknownEmployee',
  'ambiguousEmployee',
  'unknownName',
  'ambiguousName',
  'badMonth',
  'notEmployed',
  'duplicate',
  'badProrated',
  'badState',
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
  imports: [ColumnMapper, HalfWidthDigits, RouterLink, TranslocoPipe, FormsModule],
  templateUrl: './payroll-import.html',
  styleUrl: './payroll-import.css',
})
export class PayrollImport {
  private readonly employeesApi = inject(EmployeeService);
  private readonly payrollApi = inject(PayrollService);
  private readonly transloco = inject(TranslocoService);
  readonly context = inject(OfficeContext);

  readonly showErrors = SHOW_ERRORS;
  readonly showItems = SHOW_ITEMS;

  private employees: Employee[] = [];
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
  readonly tableSpec = PAYROLL_TABLE_SPEC;
  /** 読んだファイル。見出しがうちと違えば「列を合わせる」画面を出す（mapping が true の間） */
  readonly loaded = signal<{ fileName: string; encoding: CsvEncoding | null; tables: SheetTable[] } | null>(null);
  readonly mapping = signal(false);
  readonly saving = signal(false);
  readonly progress = signal<{ done: number; total: number } | null>(null);
  readonly doneCount = signal<number | null>(null);
  /** 取り込んだいちばん新しい支払月（次の一歩のリンク用。11/16） */
  readonly doneMonth = signal<string | null>(null);
  readonly partial = signal<{ done: number; total: number } | null>(null);

  readonly writes = computed(() => {
    const p = this.preview();
    return p ? [...p.created, ...p.updated] : [];
  });
  readonly canImport = computed(() => {
    const p = this.preview();
    return (
      !!p &&
      this.context.isAdmin() &&
      p.read.missingColumns.length === 0 &&
      (p.read.errors.length === 0 || this.skipErrors()) &&
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

  async exportCsv(): Promise<void> {
    const office = this.context.current();
    if (!office || !this.context.isAdmin()) return;
    this.exportErrorKey.set(null);
    if (!this.from || !this.to || this.from > this.to) {
      this.exportErrorKey.set('payrollCsv.error.range');
      return;
    }
    const months = monthsBetween(this.from, this.to);
    if (months.length > MAX_MONTHS) {
      this.exportErrorKey.set('payrollCsv.error.tooLong');
      return;
    }
    try {
      await this.ensureMonths(office.id, months);
    } catch (err) {
      console.error(err);
      this.exportErrorKey.set(errorKeyOf(err, 'payrollCsv.error.load'));
      return;
    }
    const lang = this.lang();
    const rows = buildPayrollCsv(this.employees, [...this.saved.values()], months, payrollOf(office), lang);
    downloadCsv(safeFileName(payrollFileName(office.name, this.from, this.to, todayLocal(), lang)), rows);
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
      const ours = isOurFormat(first.rows[0], PAYROLL_IMPORT_FIELDS, (f) => [
        PAYROLL_HEADERS.ja[f.key],
        PAYROLL_HEADERS.en[f.key],
      ]);
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
    this.edits.set(new Map());
    this.skipErrors.set(false);
  }

  // ===== エラーの直し方（11/16。従業員の取り込みと同じ型）：画面で直す／エラーの行だけ書き出す／エラーの行を除いて取り込む =====
  readonly edits = signal<Map<string, string>>(new Map());
  readonly skipErrors = signal(false);
  readonly cellKey = cellKey;

  fixColumns(codes: readonly string[]): string[] {
    return columnsForCodes(codes, PAYROLL_FIX);
  }

  /** 列の名前（画面の言葉） */
  columnName(c: string): string {
    return this.transloco.translate('payrollCsv.col.' + c);
  }

  editValue(line: number, column: string): string {
    return this.edits().get(cellKey(line, column)) ?? cellOf(this.lastTable ?? [], line, payrollLabels(column));
  }

  setEdit(line: number, column: string, value: string): void {
    this.edits.update((m) => new Map(m).set(cellKey(line, column), value));
  }

  /** 直した値を表に入れて、確認をやり直す */
  applyEdits(): void {
    if (!this.lastTable || this.edits().size === 0) return;
    const table = applyCellEdits(this.lastTable, this.edits(), payrollLabels);
    this.edits.set(new Map());
    this.showPreview(table);
  }

  /** エラーの行だけを書き出す（右端に「エラー」の列。Excel で直して取り込み直す） */
  exportErrorRows(): void {
    const p = this.preview();
    if (!p || !this.lastTable) return;
    const messages = new Map(
      p.read.errors.map((e) => [e.line, this.errorKeys(e.codes).map((k) => this.transloco.translate(k)).join(' ／ ')]),
    );
    downloadCsv(
      `payrolls-errors-${todayLocal()}.csv`,
      errorRowsTable(this.lastTable, messages, this.transloco.translate('employeeCsv.errorColumn')),
    );
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
    const office = this.context.current();
    const file = this.loaded();
    if (!office || !file) return;
    try {
      const read = readPayrollCsv(table, this.employees, payrollOf(office), { inKindMissing: this.inKindMissing() });
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
      await this.payrollApi.saveMany(office.id, writes, (done) =>
        this.progress.set({ done, total: writes.length }),
      );
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
    return office ? premiumMonthOfPay(paidMonth, payrollOf(office)) : paidMonth;
  }

  /** '2026-11' → 11月 */
  monthLabel(ym: string): number {
    return Number(ym.slice(5, 7));
  }
}
