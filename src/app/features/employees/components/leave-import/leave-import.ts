import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { ImportFix, ImportIssue, ImportIssues } from '../../../../shared/components/import-issues/import-issues';
import { IssueRow } from '../../../../shared/components/import-issues/issue-row';
import { OpenRow } from '../../../../shared/components/import-issues/open-row';
import { ImportPicker } from '../../../../shared/components/import-picker/import-picker';
import { ImportSteps } from '../../../../shared/components/import-steps/import-steps';
import { PersonName } from '../../../../shared/components/person-name/person-name';
import { CsvEncoding, downloadCsv } from '../../../../shared/csv/csv';
import { ImportFileError, readTables } from '../../../../shared/import/parse';
import { applyRowValues, resolveHeader } from '../../../../shared/import/row-fix';
import { watchUnsaved } from '../../../../shared/services/unsaved-changes';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { OfficeContext } from '../../../office/office-context.service';
import { EmployeeService } from '../../employee.service';
import { LEAVE_FIX_FIELDS } from '../../logic/import-fix-fields';
import { LEAVE_CSV_HEADERS, leaveCsvTemplate, LeaveImportRow, leaveLabels, planLeaveImport } from '../../logic/leave-csv';

interface Preview {
  fileName: string;
  encoding: CsvEncoding | null;
  rows: LeaveImportRow[];
  missing: string[];
  table: string[][];
}

/**
 * 休業の履歴の取り込み（11/27）：1行に1件の休業。従業員のファイルの休業の列（2件まで）の3件目から
 * 流れはほかの取り込みと同じ：ひな形 → ファイル → 確認（その場で直す）→ 取り込む。登録済みと同じ休業は飛ばす
 */
@Component({
  selector: 'app-leave-import',
  imports: [OpenRow, PersonName, IssueRow, ImportSteps, ImportPicker, ImportIssues, RouterLink, TranslocoPipe],
  templateUrl: './leave-import.html',
  styleUrl: '../../pages/employee-import/employee-import.css',
})
export class LeaveImport {
  private readonly employeesApi = inject(EmployeeService);
  private readonly transloco = inject(TranslocoService);
  readonly context = inject(OfficeContext);

  readonly headers = LEAVE_CSV_HEADERS;
  readonly fixFields = LEAVE_FIX_FIELDS;
  readonly preview = signal<Preview | null>(null);
  readonly errorKey = signal<string | null>(null);
  readonly saving = signal(false);
  readonly progress = signal<{ done: number; total: number } | null>(null);
  readonly partial = signal<{ done: number; total: number } | null>(null);
  readonly doneCount = signal<number | null>(null);
  readonly skipErrors = signal(true);
  private readonly unsaved = watchUnsaved(() => this.preview() !== null && this.doneCount() === null);
  private employees: Employee[] = [];
  private fileName = '';
  private encoding: CsvEncoding | null = null;

  private readonly fixRef = viewChild(ImportIssues);
  private kept(line: number): boolean {
    return !(this.fixRef()?.excluded().has(line) ?? false);
  }
  readonly errorRows = computed(() => this.preview()?.rows.filter((r) => r.errors.length > 0) ?? []);
  readonly addRows = computed(() => (this.preview()?.rows.filter((r) => r.leave && !r.skip) ?? []).filter((r) => this.kept(r.line)));
  readonly skipRows = computed(() => this.preview()?.rows.filter((r) => r.skip) ?? []);
  readonly canImport = computed(
    () => this.context.isAdmin() && !this.saving() && (this.errorRows().length === 0 || this.skipErrors()) && this.addRows().length > 0,
  );

  downloadTemplate(): void {
    downloadCsv('leaves-template.csv', leaveCsvTemplate());
  }

  async onFile(event: Event): Promise<void> {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    this.reset();
    try {
      const { tables, encoding } = await readTables(file);
      this.fileName = file.name;
      this.encoding = encoding;
      await this.showPreview(tables[0].rows);
    } catch (err) {
      console.error(err);
      this.errorKey.set(err instanceof ImportFileError ? `importMap.error.${err.code}` : 'employeeCsv.error.read');
    }
  }

  private async showPreview(table: string[][]): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    try {
      this.employees = await this.employeesApi.list(office.id);
      const targets = this.employees.map((e) => ({
        id: e.id,
        employeeNumber: e.employeeNumber ?? null,
        lastName: e.lastName,
        firstName: e.firstName,
        hireDate: e.hireDate,
        retireDate: e.retireDate ?? null,
        leaves: e.leaves ?? [],
      }));
      const read = planLeaveImport(table, targets);
      this.preview.set({
        fileName: this.fileName,
        encoding: this.encoding,
        rows: read.rows,
        missing: read.missing.map((c) => this.headers[c]),
        table: table.map((r) => [...r]),
      });
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'employeeCsv.error.read'));
    }
  }

  header(column: string): string {
    return resolveHeader(this.preview()?.table[0] ?? [], leaveLabels(column));
  }

  label(column: string | null): string {
    return column ? (this.headers[column as keyof typeof LEAVE_CSV_HEADERS] ?? column) : '';
  }

  readonly issues = computed<ImportIssue[]>(() =>
    this.errorRows().map((r) => ({
      line: r.line,
      messages: r.errors.map((e) => `${this.label(e.column)}${e.column ? '：' : ''}${this.transloco.translate(e.code)}`),
      headers: [...new Set(r.errors.map((e) => e.column).filter((c): c is NonNullable<typeof c> => !!c).map((c) => this.header(c)))],
    })),
  );

  async onFix(fix: ImportFix): Promise<void> {
    const p = this.preview();
    if (p) await this.showPreview(applyRowValues(p.table, fix.line, fix.values));
  }

  clear(): void {
    this.reset();
  }

  private reset(): void {
    this.partial.set(null);
    this.preview.set(null);
    this.doneCount.set(null);
    this.errorKey.set(null);
    this.skipErrors.set(true);
  }

  /** 1人ずつ書く（同じ人の休業は、登録済みに足して開始日の順に並べ、1回で書く） */
  async importCsv(): Promise<void> {
    const office = this.context.current();
    if (!office || !this.canImport()) return;
    const byEmployee = new Map<string, LeaveImportRow[]>();
    for (const r of this.addRows()) byEmployee.set(r.employee!.id, [...(byEmployee.get(r.employee!.id) ?? []), r]);
    const total = byEmployee.size;
    this.saving.set(true);
    this.progress.set({ done: 0, total });
    this.errorKey.set(null);
    let done = 0;
    try {
      for (const [id, rows] of byEmployee) {
        const e = this.employees.find((x) => x.id === id)!;
        const leaves = [...(e.leaves ?? []), ...rows.map((r) => r.leave!)].sort((a, b) => a.start.localeCompare(b.start));
        await this.employeesApi.updateLeaves(office.id, id, leaves);
        done++;
        this.progress.set({ done, total });
      }
      this.doneCount.set(this.addRows().length);
      this.preview.set(null);
    } catch (err) {
      console.error(err);
      if (done > 0) {
        this.partial.set({ done, total });
        const table = this.preview()?.table;
        if (table) await this.showPreview(table);
      } else {
        this.errorKey.set(errorKeyOf(err, 'leaveCsv.error.save'));
      }
    } finally {
      this.saving.set(false);
      this.progress.set(null);
    }
  }

  what(r: LeaveImportRow): string {
    const l = r.leave;
    if (!l) return '';
    return `${this.transloco.translate('leave.kind.' + l.kind)}　${l.start} 〜 ${l.plannedEnd ?? ''}`;
  }
}
