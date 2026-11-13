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
  personKey,
  planDependentImport,
} from '../../logic/dependent-csv';

interface Preview {
  fileName: string;
  encoding: CsvEncoding | null;
  rows: DependentImportRow[];
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
    () => this.context.isAdmin() && !this.saving() && this.errorRows().length === 0 && this.addRows().length > 0,
  );

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
      this.preview.set({ fileName: file.fileName, encoding: file.encoding, rows });
    } catch (err) {
      console.error(err);
      this.errorKey.set('employeeCsv.error.read');
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
      this.errorKey.set('dependentCsv.error.save');
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
