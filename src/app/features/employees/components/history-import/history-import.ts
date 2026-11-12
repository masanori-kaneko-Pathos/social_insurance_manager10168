import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ColumnMapper } from '../../../../shared/components/column-mapper/column-mapper';
import { CsvEncoding, downloadCsv } from '../../../../shared/csv/csv';
import { isOurFormat } from '../../../../shared/import/column-map';
import { IMPORT_ACCEPT, ImportFileError, readTables, SheetTable } from '../../../../shared/import/parse';
import { OfficeContext } from '../../../office/office-context.service';
import { RateService } from '../../../rates/rate.service';
import { EmployeeService } from '../../employee.service';
import { HistoryImportService } from '../../history-import.service';
import {
  CONTRACT_HISTORY_FIELDS,
  CONTRACT_HISTORY_SPEC,
  employeeIdsIn,
  HistoryColumn,
  historyCsvTemplate,
  HistoryCsvRead,
  HistoryCsvRow,
  historyHeaders,
  HistoryItem,
  HistoryKind,
  HistoryPlan,
  HistoryRowError,
  planHistoryImport,
  readHistoryCsv,
  REMUNERATION_HISTORY_FIELDS,
  REMUNERATION_HISTORY_SPEC,
} from '../../logic/history-csv';

interface Preview {
  fileName: string;
  encoding: CsvEncoding | null;
  read: HistoryCsvRead;
  plan: HistoryPlan;
}

/**
 * 履歴の取り込み（登録済みの従業員に、2回目からの契約・標準報酬の記録を足す）
 * 従業員の取り込みと同じ流れ：ひな形 → ファイル → （見出しが違えば列を合わせる）→ 確認 → 取り込む
 * エラーの行が1つでもあれば取り込まない。登録済みの日（月）は飛ばす（上書きしない）
 */
@Component({
  selector: 'app-history-import',
  imports: [ColumnMapper, RouterLink, TranslocoPipe],
  templateUrl: './history-import.html',
  styleUrl: '../../pages/employee-import/employee-import.css',
})
export class HistoryImport {
  private readonly employeesApi = inject(EmployeeService);
  private readonly rates = inject(RateService);
  private readonly api = inject(HistoryImportService);
  readonly context = inject(OfficeContext);

  readonly kind = input.required<HistoryKind>();

  readonly accept = IMPORT_ACCEPT;
  readonly spec = computed(() => (this.kind() === 'contract' ? CONTRACT_HISTORY_SPEC : REMUNERATION_HISTORY_SPEC));
  readonly loaded = signal<{ fileName: string; encoding: CsvEncoding | null; tables: SheetTable[] } | null>(null);
  readonly mapping = signal(false);
  readonly preview = signal<Preview | null>(null);
  readonly errorKey = signal<string | null>(null);
  readonly saving = signal(false);
  readonly progress = signal<{ done: number; total: number } | null>(null);
  readonly doneCount = signal<number | null>(null);

  readonly rowErrors = computed(() => this.preview()?.read.rows.filter((r) => r.errors.length > 0) ?? []);
  readonly canImport = computed(() => {
    const p = this.preview();
    return (
      !!p &&
      this.context.isAdmin() &&
      !this.saving() &&
      p.read.missingColumns.length === 0 &&
      this.rowErrors().length === 0 &&
      p.plan.errors.length === 0 &&
      p.plan.items.length > 0
    );
  });

  constructor() {
    // 種類を切り替えたら、読んだファイルは捨てる（列が違うため）
    effect(() => {
      this.kind();
      untracked(() => this.reset());
    });
  }

  downloadTemplate(): void {
    downloadCsv(`${this.kind()}-history-template.csv`, historyCsvTemplate(this.kind()));
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
      const fields = this.kind() === 'contract' ? CONTRACT_HISTORY_FIELDS : REMUNERATION_HISTORY_FIELDS;
      if (tables.length === 1 && !first.pdf && isOurFormat(first.rows[0], fields)) {
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
    const kind = this.kind();
    try {
      const read = readHistoryCsv(kind, table);
      const [employees, gradeTables] = await Promise.all([this.employeesApi.list(office.id), this.rates.grades()]);
      // 登録済みの記録は、ファイルに出てくる人の分だけ読む
      const existing = await this.api.existingIds(office.id, kind, employeeIdsIn(read.rows, employees));
      const plan = planHistoryImport(read.rows, { employees, existing, gradeTables });
      this.preview.set({ fileName: file.fileName, encoding: file.encoding, read, plan });
    } catch (err) {
      console.error(err);
      this.errorKey.set('employeeCsv.error.read');
    }
  }

  async importCsv(): Promise<void> {
    const office = this.context.current();
    const p = this.preview();
    if (!office || !p || !this.canImport()) return;
    const total = p.plan.items.length;
    this.saving.set(true);
    this.progress.set({ done: 0, total });
    this.errorKey.set(null);
    try {
      const n = await this.api.importMany(office.id, p.plan.items, (done) => this.progress.set({ done, total }));
      this.reset();
      this.doneCount.set(n);
    } catch (err) {
      console.error(err);
      const done = this.progress()?.done ?? 0;
      // 途中で止まっても、取り込み直せば登録済みの分は飛ばされる
      this.errorKey.set(done > 0 ? 'historyCsv.error.partial' : 'employeeCsv.error.save');
    } finally {
      this.saving.set(false);
      this.progress.set(null);
    }
  }

  // ===== 表示 =====
  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  hours(it: HistoryItem): string {
    const m = it.contract?.weeklyMinutes ?? 0;
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  }
  cellOf(r: HistoryCsvRow, e: HistoryRowError): string {
    return e.column ? (r.values[e.column] ?? '') : '';
  }
  columnLabel(c: HistoryColumn | null): string {
    return c ? (historyHeaders(this.kind())[c] ?? c) : '';
  }
}
