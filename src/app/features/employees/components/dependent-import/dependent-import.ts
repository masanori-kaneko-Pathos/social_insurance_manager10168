import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ColumnMapper } from '../../../../shared/components/column-mapper/column-mapper';
import { CsvEncoding, downloadCsv } from '../../../../shared/csv/csv';
import { isOurFormat } from '../../../../shared/import/column-map';
import { IMPORT_ACCEPT, ImportFileError, readTables, SheetTable } from '../../../../shared/import/parse';
import { todayLocal } from '../../../../shared/utils/date';
import { OfficeContext } from '../../../office/office-context.service';
import { DependentService } from '../../dependent.service';
import { EmployeeService } from '../../employee.service';
import {
  DEPENDENT_IMPORT_FIELDS,
  DEPENDENT_TABLE_SPEC,
  dependentCsvTemplate,
  DependentImportRow,
  DEPENDENT_CSV_HEADERS,
  DependentColumn,
  dependentFixColumns,
  personKey,
  planDependentImport,
} from '../../logic/dependent-csv';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { applyCellEdits, cellKey, cellOf, errorRowsTable } from '../../../../shared/import/row-fix';
import { TranslocoService } from '@jsverse/transloco';

interface Preview {
  fileName: string;
  encoding: CsvEncoding | null;
  rows: DependentImportRow[];
  /** 読んだ表（うちの見出し）。画面で直すとき・エラーの行を書き出すときに使う（11/16） */
  table: string[][];
}

/** 同時に書く人数（1人 ＝ 扶養家族1件 ＋ 変更履歴1件） */
const PARALLEL = 8;

/**
 * 扶養家族の取り込み（1行 ＝ 扶養家族1人。社員番号で結ぶ。11/13）
 * 従業員の取り込みと同じ流れ：ひな形 → ファイル → （見出しが違えば列を合わせる）→ 確認 → 取り込む
 * エラーの行が1つでもあれば取り込まない。登録済みの人（同じ氏名＋生年月日）は飛ばす（上書きしない）
 */
@Component({
  selector: 'app-dependent-import',
  imports: [ColumnMapper, RouterLink, TranslocoPipe],
  templateUrl: './dependent-import.html',
  styleUrl: '../../pages/employee-import/employee-import.css',
})
export class DependentImport {
  private readonly employeesApi = inject(EmployeeService);
  private readonly dependentsApi = inject(DependentService);
  readonly context = inject(OfficeContext);

  readonly accept = IMPORT_ACCEPT;
  readonly spec = DEPENDENT_TABLE_SPEC;
  readonly headers = DEPENDENT_CSV_HEADERS;

  readonly loaded = signal<{ fileName: string; encoding: CsvEncoding | null; tables: SheetTable[] } | null>(null);
  readonly mapping = signal(false);
  readonly preview = signal<Preview | null>(null);
  readonly errorKey = signal<string | null>(null);
  readonly saving = signal(false);
  readonly progress = signal<{ done: number; total: number } | null>(null);
  readonly doneCount = signal<number | null>(null);

  readonly errorRows = computed(() => this.preview()?.rows.filter((r) => r.errors.length > 0) ?? []);
  readonly addRows = computed(() => this.preview()?.rows.filter((r) => r.input) ?? []);
  readonly skipRows = computed(() => this.preview()?.rows.filter((r) => r.skip) ?? []);
  readonly warnCount = computed(() => this.addRows().filter((r) => r.warnings.length > 0).length);
  readonly canImport = computed(
    () =>
      this.context.isAdmin() &&
      !this.saving() &&
      (this.errorRows().length === 0 || this.skipErrors()) &&
      this.addRows().length > 0,
  );

  // ===== エラーの直し方（11/16。従業員の取り込みと同じ型）：画面で直す／エラーの行だけ書き出す／エラーの行を除いて取り込む =====
  private readonly transloco = inject(TranslocoService);
  readonly edits = signal<Map<string, string>>(new Map());
  readonly skipErrors = signal(false);
  readonly cellKey = cellKey;

  fixColumns(r: DependentImportRow): DependentColumn[] {
    return dependentFixColumns(r.errors);
  }

  editValue(line: number, column: DependentColumn): string {
    const t = this.preview()?.table ?? [];
    return this.edits().get(cellKey(line, column)) ?? cellOf(t, line, [this.headers[column]]);
  }

  setEdit(line: number, column: string, value: string): void {
    this.edits.update((m) => new Map(m).set(cellKey(line, column), value));
  }

  /** 直した値を表に入れて、確認をやり直す */
  async applyEdits(): Promise<void> {
    const p = this.preview();
    if (!p || this.edits().size === 0) return;
    const table = applyCellEdits(p.table, this.edits(), (c) => [this.headers[c as DependentColumn] ?? c]);
    this.edits.set(new Map());
    await this.showPreview(table);
  }

  /** エラーの行だけを書き出す（右端に「エラー」の列） */
  exportErrorRows(): void {
    const p = this.preview();
    if (!p) return;
    const messages = new Map(
      this.errorRows().map((r) => [
        r.line,
        r.errors
          .map((e) => {
            const t = this.errorText(e);
            return `${this.fieldLabel(t.field)}${t.field ? '：' : ''}${this.transloco.translate(t.key)}`;
          })
          .join(' ／ '),
      ]),
    );
    downloadCsv(`dependents-errors-${todayLocal()}.csv`, errorRowsTable(p.table, messages, this.transloco.translate('employeeCsv.errorColumn')));
  }

  downloadTemplate(): void {
    downloadCsv('dependents-template.csv', dependentCsvTemplate());
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
      if (tables.length === 1 && !first.pdf && isOurFormat(first.rows[0], DEPENDENT_IMPORT_FIELDS)) {
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

  clear(): void {
    this.reset();
  }

  private reset(): void {
    this.loaded.set(null);
    this.mapping.set(false);
    this.preview.set(null);
    this.doneCount.set(null);
    this.errorKey.set(null);
    this.edits.set(new Map());
    this.skipErrors.set(false);
  }

  private async showPreview(table: string[][]): Promise<void> {
    const office = this.context.current();
    const file = this.loaded();
    if (!office || !file) return;
    try {
      const employees = await this.employeesApi.list(office.id);
      const targets = employees.map((e) => ({
        id: e.id,
        employeeNumber: e.employeeNumber ?? null,
        lastName: e.lastName,
        firstName: e.firstName,
        hireDate: e.hireDate,
      }));
      const today = todayLocal();
      // 1回目：結ぶだけ（登録済みの扶養家族は、ファイルに出てくる人の分だけ読む）
      const first = planDependentImport(table, targets, new Map(), today);
      const ids = [...new Set(first.map((r) => r.employee?.id).filter((x): x is string => !!x))];
      const lists = await Promise.all(ids.map((id) => this.dependentsApi.list(office.id, id)));
      const existing = new Map(
        ids.map((id, i) => [id, new Set(lists[i].map((d) => personKey(d.lastName, d.firstName, d.birthDate)))]),
      );
      const rows = planDependentImport(table, targets, existing, today);
      this.preview.set({ fileName: file.fileName, encoding: file.encoding, rows, table: table.map((r) => [...r]) });
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'employeeCsv.error.read'));
    }
  }

  async importCsv(): Promise<void> {
    const office = this.context.current();
    if (!office || !this.canImport()) return;
    const items = this.addRows();
    const total = items.length;
    this.saving.set(true);
    this.progress.set({ done: 0, total });
    this.errorKey.set(null);
    let done = 0;
    try {
      for (let i = 0; i < items.length; i += PARALLEL) {
        await Promise.all(
          items.slice(i, i + PARALLEL).map((r) => this.dependentsApi.create(office.id, r.employee!.id, r.input!)),
        );
        done = Math.min(total, i + PARALLEL);
        this.progress.set({ done, total });
      }
      this.doneCount.set(total);
      this.preview.set(null);
      this.loaded.set(null);
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'dependentCsv.error.save'));
      this.doneCount.set(done);
    } finally {
      this.saving.set(false);
      this.progress.set(null);
    }
  }

  /** エラーの言葉（画面と同じチェックの分は、扶養家族の画面の言葉を使う） */
  errorText(code: string): { key: string; field: string | null } {
    if (code.startsWith('field.')) {
      const [, field, err] = code.split('.');
      return { key: `dependentCsv.fieldError.${err}`, field };
    }
    return { key: `dependentCsv.error.${code}`, field: null };
  }

  /** 欄の名前（CSV の見出し。なければそのまま） */
  fieldLabel(field: string | null): string {
    if (!field) return '';
    return (this.headers as Record<string, string>)[field] ?? field;
  }
}
