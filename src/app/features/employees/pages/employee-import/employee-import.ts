import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { CsvEncoding, decodeCsv, downloadCsv, parseCsv } from '../../../../shared/csv/csv';
import { CriteriaService } from '../../../office/criteria.service';
import { OfficeContext } from '../../../office/office-context.service';
import { RateService } from '../../../rates/rate.service';
import { EmployeeService } from '../../employee.service';
import { EmployeeImportService } from '../../employee-import.service';
import {
  CsvRowError,
  EMPLOYEE_CSV_HEADERS,
  EmployeeCsvRow,
  employeeCsvTemplate,
  EmployeeCsvRead,
  ImportItem,
  ImportPlan,
  planImport,
  readEmployeeCsv,
} from '../../logic/employee-csv';
import { reasonParams } from '../../logic/classify';

interface Preview {
  fileName: string;
  encoding: CsvEncoding;
  read: EmployeeCsvRead;
  plan: ImportPlan;
}

/**
 * 従業員の取り込み（CSV）
 * 1行 ＝ 1人 ＝ 従業員の基本 ＋ 最初の雇用契約。加入するかと標準報酬は、契約から計算して確認画面で見せる
 * エラーの行が1つでもあれば取り込まない（直してから選び直す）
 */
@Component({
  selector: 'app-employee-import',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './employee-import.html',
  styleUrl: './employee-import.css',
})
export class EmployeeImport {
  private readonly employeesApi = inject(EmployeeService);
  private readonly criteriaApi = inject(CriteriaService);
  private readonly rates = inject(RateService);
  private readonly api = inject(EmployeeImportService);
  readonly context = inject(OfficeContext);

  readonly headers = EMPLOYEE_CSV_HEADERS;
  readonly preview = signal<Preview | null>(null);
  readonly errorKey = signal<string | null>(null);
  readonly saving = signal(false);
  readonly progress = signal<{ done: number; total: number } | null>(null);
  readonly doneCount = signal<number | null>(null);

  readonly rowErrors = computed(
    () => this.preview()?.read.rows.filter((r) => r.errors.length > 0) ?? [],
  );
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
  readonly reasonParams = reasonParams;
  readonly insuredCount = computed(
    () =>
      this.preview()?.plan.items.filter(
        (i) => i.employee.health.enrolled || i.employee.pension.enrolled,
      ).length ?? 0,
  );

  downloadTemplate(): void {
    downloadCsv('employees-template.csv', employeeCsvTemplate());
  }

  async onFile(event: Event): Promise<void> {
    const office = this.context.current();
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // 同じファイルを選び直しても反応するように
    if (!office || !file) return;
    this.preview.set(null);
    this.doneCount.set(null);
    this.errorKey.set(null);
    try {
      const [{ text, encoding }, existing, criteria, gradeTables] = await Promise.all([
        file.arrayBuffer().then(decodeCsv),
        this.employeesApi.list(office.id),
        this.criteriaApi.list(),
        this.rates.grades(),
      ]);
      const read = readEmployeeCsv(parseCsv(text));
      const plan = planImport(read.rows, {
        office: {
          standardHours: office.standardHours ?? null,
          specificApplication: office.specificApplication,
        },
        criteria,
        gradeTables,
        existingNumbers: new Set(existing.map((e) => e.employeeNumber ?? '').filter(Boolean)),
      });
      this.preview.set({ fileName: file.name, encoding, read, plan });
    } catch (err) {
      console.error(err);
      this.errorKey.set('employeeCsv.error.read');
    }
  }

  clear(): void {
    this.preview.set(null);
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
      const n = await this.api.importMany(office.id, p.plan.items, (done) =>
        this.progress.set({ done, total }),
      );
      this.doneCount.set(n);
      this.preview.set(null);
    } catch (err) {
      console.error(err);
      const done = this.progress()?.done ?? 0;
      this.errorKey.set(done > 0 ? 'employeeCsv.error.partial' : 'employeeCsv.error.save');
    } finally {
      this.saving.set(false);
      this.progress.set(null);
    }
  }

  // ===== 表示 =====
  name(it: ImportItem): string {
    return `${it.employee.lastName} ${it.employee.firstName}`.trim();
  }
  hours(it: ImportItem): string {
    const m = it.contract.weeklyMinutes;
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  }
  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  /** エラーのあったセルの値 */
  cellOf(r: EmployeeCsvRow, e: CsvRowError): string {
    return e.column ? (r.values[e.column] ?? '') : '';
  }
  columnLabel(c: keyof typeof EMPLOYEE_CSV_HEADERS | null): string {
    return c ? EMPLOYEE_CSV_HEADERS[c] : '';
  }
}
