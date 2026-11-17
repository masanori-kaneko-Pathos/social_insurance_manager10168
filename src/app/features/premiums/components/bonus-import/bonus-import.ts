import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ColumnMapper } from '../../../../shared/components/column-mapper/column-mapper';
import { ImportFix, ImportIssue, ImportIssues } from '../../../../shared/components/import-issues/import-issues';
import { ImportPicker } from '../../../../shared/components/import-picker/import-picker';
import { CsvEncoding, downloadCsv } from '../../../../shared/csv/csv';
import { isOurFormat } from '../../../../shared/import/column-map';
import { IMPORT_ACCEPT, ImportFileError, readTables, SheetTable } from '../../../../shared/import/parse';
import { applyRowValues } from '../../../../shared/import/row-fix';
import { watchUnsaved } from '../../../../shared/services/unsaved-changes';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import { BonusService } from '../../bonus.service';
import {
  BONUS_CSV_FIELDS,
  BONUS_FIX_FIELDS,
  BONUS_CSV_HEADERS,
  BONUS_TABLE_SPEC,
  bonusCsvTemplate,
  bonusFixColumns,
  BonusCsvRow,
  BonusPlan,
  planBonusImport,
} from '../../logic/bonus-csv';
import { FixButton, IssueRow } from '../../../../shared/components/import-issues/issue-row';
import { ImportSteps } from '../../../../shared/components/import-steps/import-steps';

interface Preview {
  fileName: string;
  encoding: CsvEncoding | null;
  plan: BonusPlan;
  /** 読んだ表（うちの見出し）。画面で直すとき・エラーの行を書き出すときに使う */
  table: string[][];
}

/**
 * 賞与の取り込み（ファイルの取り込みのページの「賞与」。11/17）
 * 1行 ＝ 1人 × 1回の支給。同じ支払日の行を1回の支給にまとめ、登録済みの支給には足し込む
 * ほかの区分と同じ流れ：ファイル → （見出しが違えば列を合わせる）→ 確認 → 取り込む
 */
@Component({
  selector: 'app-bonus-import',
  imports: [FixButton, IssueRow, ImportSteps, ImportPicker, ColumnMapper, ImportIssues, RouterLink, TranslocoPipe],
  templateUrl: './bonus-import.html',
  styleUrl: '../../../employees/pages/employee-import/employee-import.css',
})
export class BonusImport {
  private readonly employeesApi = inject(EmployeeService);
  private readonly bonusApi = inject(BonusService);
  private readonly transloco = inject(TranslocoService);
  readonly context = inject(OfficeContext);

  readonly accept = IMPORT_ACCEPT;
  readonly spec = BONUS_TABLE_SPEC;
  readonly headers = BONUS_CSV_HEADERS;

  readonly loaded = signal<{ fileName: string; encoding: CsvEncoding | null; tables: SheetTable[] } | null>(null);
  readonly mapping = signal(false);
  readonly preview = signal<Preview | null>(null);
  readonly errorKey = signal<string | null>(null);
  readonly saving = signal(false);
  readonly progress = signal<{ done: number; total: number } | null>(null);
  /** 取り込んだ人数と支給の数 */
  readonly done = signal<{ people: number; payments: number } | null>(null);
  readonly skipErrors = signal(false);
  /** 窓で直すときの欄の種類（11/17） */
  readonly fixFields = BONUS_FIX_FIELDS;
  /** 読んだのにまだ取り込んでいなければ、画面を離れる前に確かめる */
  private readonly unsaved = watchUnsaved(() => (this.loaded() !== null || this.preview() !== null) && this.done() === null);

  readonly rows = computed(() => this.preview()?.plan.rows ?? []);
  readonly errorRows = computed(() => this.rows().filter((r) => r.status === 'error'));
  readonly writes = computed(() => this.preview()?.plan.writes ?? []);
  readonly peopleToWrite = computed(() => this.writes().reduce((n, w) => n + w.count, 0));
  readonly count = computed(() => {
    const c = { new: 0, add: 0, update: 0, same: 0, error: 0 };
    for (const r of this.rows()) c[r.status]++;
    return c;
  });
  readonly canImport = computed(
    () =>
      this.context.isAdmin() &&
      !this.saving() &&
      (this.errorRows().length === 0 || this.skipErrors()) &&
      this.writes().length > 0,
  );

  readonly issues = computed<ImportIssue[]>(() =>
    this.errorRows().map((r) => ({
      line: r.line,
      messages: r.errors.map((e) => this.transloco.translate(`bonusCsv.error.${e}`)),
      headers: bonusFixColumns(r.errors).map((c) => this.headers[c]),
    })),
  );

  downloadTemplate(): void {
    downloadCsv('bonuses-template.csv', bonusCsvTemplate());
  }

  async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.reset();
    try {
      const { tables, encoding } = await readTables(file);
      this.loaded.set({ fileName: file.name, encoding, tables });
      const [first] = tables;
      if (tables.length === 1 && !first.pdf && isOurFormat(first.rows[0], BONUS_CSV_FIELDS)) {
        await this.showPreview(first.rows);
      } else {
        this.mapping.set(true);
      }
    } catch (err) {
      console.error(err);
      this.errorKey.set(err instanceof ImportFileError ? `importMap.error.${err.code}` : 'employeeCsv.error.read');
    }
  }

  async onMapped(table: string[][]): Promise<void> {
    this.mapping.set(false);
    await this.showPreview(table);
  }

  remap(): void {
    this.preview.set(null);
    this.mapping.set(true);
  }

  async onFix(fix: ImportFix): Promise<void> {
    const p = this.preview();
    if (!p) return;
    await this.showPreview(applyRowValues(p.table, fix.line, fix.values));
  }

  clear(): void {
    this.reset();
  }

  private reset(): void {
    this.loaded.set(null);
    this.mapping.set(false);
    this.preview.set(null);
    this.done.set(null);
    this.errorKey.set(null);
    this.skipErrors.set(false);
  }

  private async showPreview(table: string[][]): Promise<void> {
    const office = this.context.current();
    const file = this.loaded();
    if (!office || !file) return;
    try {
      const [employees, payments] = await Promise.all([this.employeesApi.list(office.id), this.bonusApi.list(office.id)]);
      const targets = employees.map((e) => ({
        id: e.id,
        employeeNumber: e.employeeNumber ?? null,
        lastName: e.lastName,
        firstName: e.firstName,
        hireDate: e.hireDate,
        retireDate: e.retireDate ?? null,
      }));
      const plan = planBonusImport(table, targets, payments);
      this.preview.set({ fileName: file.fileName, encoding: file.encoding, plan, table: table.map((r) => [...r]) });
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'employeeCsv.error.read'));
    }
  }

  /** 支払日ごとに、新しく作るか足し込む（1回の支給 ＝ 1件の書き込み） */
  async importCsv(): Promise<void> {
    const office = this.context.current();
    if (!office || !this.canImport()) return;
    const writes = this.writes();
    const people = this.peopleToWrite();
    this.saving.set(true);
    this.progress.set({ done: 0, total: writes.length });
    this.errorKey.set(null);
    try {
      for (const [i, w] of writes.entries()) {
        if (w.existingId) await this.bonusApi.update(office.id, w.existingId, w.input);
        else await this.bonusApi.create(office.id, w.input);
        this.progress.set({ done: i + 1, total: writes.length });
      }
      this.done.set({ people, payments: writes.length });
      this.preview.set(null);
      this.loaded.set(null);
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'bonusCsv.error.save'));
    } finally {
      this.saving.set(false);
      this.progress.set(null);
    }
  }

  // ===== 表示 =====

  name(r: BonusCsvRow): string {
    return r.employee ? `${r.employee.lastName} ${r.employee.firstName}` : r.label || '—';
  }

  yen(n: number | null): string {
    return n === null ? '—' : `${n.toLocaleString('ja-JP')}円`;
  }
}
