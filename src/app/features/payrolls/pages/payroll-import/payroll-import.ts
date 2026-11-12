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
  PAYROLL_HEADERS,
  PAYROLL_IMPORT_FIELDS,
  PAYROLL_TABLE_SPEC,
  payrollFileName,
  readPayrollCsv,
} from '../../logic/payroll-csv';
import { monthsBetween, shiftMonth, todayLocal } from '../../../../shared/utils/date';
import { latestPaidMonth } from '../../logic/payroll-rows';
import { payrollOf } from '../../../office/office-settings';
import { PartialSaveError, PayrollService } from '../../payroll.service';

import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
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
  private saved = new Map<string, Payroll>(); // 'employeeId|paidMonth' → 保存済み

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
      p.read.errors.length === 0 &&
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
      const payrolls = await this.payrollApi.listOfOffice(
        office.id,
        this.employees.map((e) => e.id),
      );
      this.saved = new Map(payrolls.map((p) => [`${p.employeeId}|${p.paidMonth}`, p]));
    } catch (err) {
      console.error(err);
      this.errorKey.set('payrollCsv.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  private lang(): CsvLang {
    return this.transloco.getActiveLang() === 'en' ? 'en' : 'ja';
  }

  // ===== 書き出し =====

  exportCsv(): void {
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
    this.partial.set(null);
    this.errorKey.set(null);
    this.inKindMissing.set('zero');
    this.lastTable = null;
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

  private showPreview(table: string[][]): void {
    this.lastTable = table;
    const office = this.context.current();
    const file = this.loaded();
    if (!office || !file) return;
    try {
      const read = readPayrollCsv(table, this.employees, payrollOf(office), { inKindMissing: this.inKindMissing() });
      this.preview.set({ fileName: file.fileName, encoding: file.encoding, read, ...classifyImport(read.items, this.saved) });
    } catch (err) {
      console.error(err);
      this.errorKey.set('payrollCsv.error.read');
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
}
