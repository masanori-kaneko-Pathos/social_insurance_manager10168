import { Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ImportPicker } from '../../../../shared/components/import-picker/import-picker';
import { ImportFix, ImportIssue, ImportIssues } from '../../../../shared/components/import-issues/import-issues';
import { Employee } from '../../../../core/models/employee';
import { CsvEncoding, downloadCsv } from '../../../../shared/csv/csv';
import { applyRowValues, resolveHeader } from '../../../../shared/import/row-fix';
import { ImportFileError, readTables } from '../../../../shared/import/parse';
import { todayLocal } from '../../../../shared/utils/date';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { OfficeContext } from '../../../office/office-context.service';
import { AgreementService } from '../../agreement.service';
import { EmployeeService } from '../../employee.service';
import {
  abroadCsvTemplate,
  abroadFixColumns,
  abroadHeaders,
  abroadLabels,
  AbroadImportRow,
  AbroadKind,
  AbroadRowError,
  planAbroadImport,
} from '../../logic/abroad-csv';
import { watchUnsaved } from '../../../../shared/services/unsaved-changes';
import { CERTIFICATE_FIX_FIELDS, OVERSEAS_FIX_FIELDS } from '../../logic/import-fix-fields';
import { IssueRow } from '../../../../shared/components/import-issues/issue-row';
import { ImportSteps } from '../../../../shared/components/import-steps/import-steps';
import { PersonName } from '../../../../shared/components/person-name/person-name';

interface Preview {
  fileName: string;
  encoding: CsvEncoding | null;
  rows: AbroadImportRow[];
  missing: string[];
  table: string[][];
}

/**
 * 社会保障協定の適用証明書・海外勤務の取り込み（B9。11/17）
 * 扶養家族の取り込みと同じ流れ：ひな形 → ファイル → 確認（その場で直す）→ 取り込む
 * 登録済みと同じ行は飛ばす。証明書は1人1枚なので、違う証明書は差し替える（注意を出す）
 */
@Component({
  selector: 'app-abroad-import',
  imports: [PersonName, IssueRow, ImportSteps, ImportPicker, ImportIssues, RouterLink, TranslocoPipe],
  templateUrl: './abroad-import.html',
  styleUrl: '../../pages/employee-import/employee-import.css',
})
export class AbroadImport {
  private readonly employeesApi = inject(EmployeeService);
  private readonly agreementsApi = inject(AgreementService);
  readonly context = inject(OfficeContext);

  readonly kind = input.required<AbroadKind>();
  readonly headers = computed(() => abroadHeaders(this.kind()));

  readonly preview = signal<Preview | null>(null);
  readonly errorKey = signal<string | null>(null);
  readonly saving = signal(false);
  readonly progress = signal<{ done: number; total: number } | null>(null);
  readonly doneCount = signal<number | null>(null);
  /** 読んだのにまだ取り込んでいなければ、画面を離れる前に確かめる（11/17） */
  private readonly unsaved = watchUnsaved(() => this.preview() !== null && this.doneCount() === null);
  readonly skipErrors = signal(true); // 問題の行は、行のチェックが外れて取り込まない（11/17）
  /** 窓で直すときの欄の種類（11/17） */
  readonly fixFields = computed(() => (this.kind() === 'certificate' ? CERTIFICATE_FIX_FIELDS : OVERSEAS_FIX_FIELDS));
  private employees: Employee[] = [];
  private fileName = '';
  private encoding: CsvEncoding | null = null;

  readonly errorRows = computed(() => this.preview()?.rows.filter((r) => r.errors.length > 0) ?? []);
  // ===== 行ごとのチェック（11/17）：外した行は取り込まない =====
  private readonly fixRef = viewChild(ImportIssues);
  private kept(line: number): boolean {
    return !(this.fixRef()?.excluded().has(line) ?? false);
  }
  readonly addRows = computed(() => (this.preview()?.rows.filter((r) => r.certificate || r.overseas) ?? []).filter((r) => this.kept(r.line)));
  readonly skipRows = computed(() => this.preview()?.rows.filter((r) => r.skip) ?? []);
  readonly canImport = computed(
    () =>
      this.context.isAdmin() &&
      !this.saving() &&
      (this.errorRows().length === 0 || this.skipErrors()) &&
      this.addRows().length > 0,
  );

  downloadTemplate(): void {
    downloadCsv(`${this.kind()}-template.csv`, abroadCsvTemplate(this.kind()));
  }

  async onFile(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
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
      const [employees, agreements] = await Promise.all([this.employeesApi.list(office.id), this.agreementsApi.list()]);
      this.employees = employees;
      const targets = employees.map((e) => ({
        id: e.id,
        employeeNumber: e.employeeNumber ?? null,
        lastName: e.lastName,
        firstName: e.firstName,
        foreign: !!e.foreign,
        certificate: e.foreign?.certificate ?? null,
        overseas: e.overseas ?? [],
        birthDate: e.birthDate,
        careExemptions: e.careExemptions ?? [],
      }));
      const read = planAbroadImport(this.kind(), table, targets, { agreements, today: todayLocal() });
      const headers = this.headers();
      this.preview.set({
        fileName: this.fileName,
        encoding: this.encoding,
        rows: read.rows,
        missing: read.missing.map((c) => headers[c] ?? c),
        table: table.map((r) => [...r]),
      });
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'employeeCsv.error.read'));
    }
  }

  // ===== エラーの直し方（11/17。共通の部品 app-import-issues） =====
  private readonly transloco = inject(TranslocoService);

  /** 表にある見出しの書き方 */
  header(column: string): string {
    return resolveHeader(this.preview()?.table[0] ?? [], abroadLabels(this.kind(), column));
  }

  readonly issues = computed<ImportIssue[]>(() => {
    const p = this.preview();
    if (!p) return [];
    return this.errorRows().map((r) => {
      const messages = r.errors.map((e) => `${this.label(e.column)}${e.column ? '：' : ''}${this.transloco.translate(this.errorText(e))}`);
      if (r.errors.some((e) => e.code === 'unknownEmployee')) messages.push(this.transloco.translate('importFix.unknownEmployee'));
      return { line: r.line, messages, headers: abroadFixColumns(r.errors).map((c) => this.header(c)) };
    });
  });

  async onFix(fix: ImportFix): Promise<void> {
    const p = this.preview();
    if (!p) return;
    await this.showPreview(applyRowValues(p.table, fix.line, fix.values));
  }

  clear(): void {
    this.reset();
  }

  private reset(): void {
    this.preview.set(null);
    this.doneCount.set(null);
    this.errorKey.set(null);
    this.skipErrors.set(true);
  }

  /** 1人ずつ書く（同じ人の海外勤務が2件あれば、まとめて1回で書く） */
  async importCsv(): Promise<void> {
    const office = this.context.current();
    if (!office || !this.canImport()) return;
    const byEmployee = new Map<string, AbroadImportRow[]>();
    for (const r of this.addRows()) byEmployee.set(r.employee!.id, [...(byEmployee.get(r.employee!.id) ?? []), r]);
    const total = byEmployee.size;
    this.saving.set(true);
    this.progress.set({ done: 0, total });
    this.errorKey.set(null);
    let done = 0;
    try {
      for (const [id, rows] of byEmployee) {
        const e = this.employees.find((x) => x.id === id)!;
        if (this.kind() === 'certificate') {
          await this.employeesApi.updateCertificate(office.id, e, rows[rows.length - 1].certificate!);
        } else {
          const added = rows.map((r) => r.overseas!);
          const overseas = [...(e.overseas ?? []), ...added].sort((a, b) => a.from.localeCompare(b.from));
          await this.employeesApi.updateOverseas(office.id, id, overseas);
        }
        done++;
        this.progress.set({ done, total });
      }
      this.doneCount.set(this.addRows().length);
      this.preview.set(null);
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'abroadCsv.error.save'));
    } finally {
      this.saving.set(false);
      this.progress.set(null);
    }
  }

  errorText(e: AbroadRowError): string {
    return `abroadCsv.error.${e.code}`;
  }

  label(column: string | null): string {
    return column ? (this.headers()[column] ?? column) : '';
  }

  name(r: AbroadImportRow): string {
    return r.employee ? `${r.employee.lastName} ${r.employee.firstName}`.trim() : '—';
  }

  what(r: AbroadImportRow): string {
    const c = r.certificate;
    if (c) return `${c.country}　${c.from} 〜 ${c.to ?? ''}`;
    const o = r.overseas;
    if (o) return `${o.country}　${o.from} 〜 ${o.to ?? ''}`;
    return '';
  }
}
