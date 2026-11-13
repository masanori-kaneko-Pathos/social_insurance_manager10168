import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ColumnMapper } from '../../../../shared/components/column-mapper/column-mapper';
import { CsvEncoding, downloadCsv } from '../../../../shared/csv/csv';
import { isOurFormat } from '../../../../shared/import/column-map';
import { IMPORT_ACCEPT, ImportFileError, readTables, SheetTable } from '../../../../shared/import/parse';
import { CriteriaService } from '../../../office/criteria.service';
import { OfficeContext } from '../../../office/office-context.service';
import { RateService } from '../../../rates/rate.service';
import { EmployeeService } from '../../employee.service';
import { EmployeeImportService } from '../../employee-import.service';
import { PasswordGate } from '../../../my-number/components/password-gate/password-gate';
import { myNumberReason, MyNumberService } from '../../../my-number/my-number.service';
import { MyNumberImportRead, myNumberCsv, readMyNumberTable } from '../../../my-number/logic/my-number-csv';
import { todayLocal } from '../../../../shared/utils/date';
import {
  CsvRowError,
  EMPLOYEE_CSV_HEADERS,
  EMPLOYEE_IMPORT_FIELDS,
  EMPLOYEE_TABLE_SPEC,
  EmployeeCsvRow,
  employeeCsvTemplate,
  EmployeeCsvRead,
  ImportItem,
  ImportPlan,
  planImport,
  readEmployeeCsv,
} from '../../logic/employee-csv';
import { reasonParams } from '../../logic/classify';
import { DependentImport } from '../../components/dependent-import/dependent-import';
import { HistoryImport } from '../../components/history-import/history-import';

/** 何を取り込むか：従業員（1行1人）／扶養家族（1行1人。11/13）／契約の履歴／標準報酬の履歴（登録済みの人に足す） */
export type ImportMode = 'employees' | 'dependents' | 'contract' | 'remuneration';
export const IMPORT_MODES: readonly ImportMode[] = ['employees', 'dependents', 'contract', 'remuneration'];

interface Preview {
  fileName: string;
  encoding: CsvEncoding | null; // Excel・PDF は null
  read: EmployeeCsvRead;
  plan: ImportPlan;
  /** 読んだ表（うちの見出し）。画面で直すとき・エラーの行を書き出すときに使う */
  table: string[][];
}

/** エラーがこれより多いときは、書き出して Excel で直すことを勧める */
const INLINE_FIX_LIMIT = 30;

/**
 * 従業員の取り込み（CSV）
 * 1行 ＝ 1人 ＝ 従業員の基本 ＋ 最初の雇用契約。加入するかと標準報酬は、契約から計算して確認画面で見せる
 * エラーの行が1つでもあれば取り込まない（直してから選び直す）
 */
@Component({
  selector: 'app-employee-import',
  imports: [ColumnMapper, DependentImport, HistoryImport, PasswordGate, RouterLink, TranslocoPipe],
  templateUrl: './employee-import.html',
  styleUrl: './employee-import.css',
})
export class EmployeeImport {
  private readonly employeesApi = inject(EmployeeService);
  private readonly criteriaApi = inject(CriteriaService);
  private readonly rates = inject(RateService);
  private readonly api = inject(EmployeeImportService);
  readonly context = inject(OfficeContext);
  private readonly myNumbers = inject(MyNumberService);

  readonly modes = IMPORT_MODES;
  /** ?mode=dependents などで開ける（ホームの「ファイルから取り込む」から。11/13） */
  private readonly route = inject(ActivatedRoute);
  readonly mode = signal<ImportMode>(
    (IMPORT_MODES as readonly string[]).includes(this.route.snapshot.queryParamMap.get('mode') ?? '')
      ? (this.route.snapshot.queryParamMap.get('mode') as ImportMode)
      : 'employees',
  );
  readonly headers = EMPLOYEE_CSV_HEADERS;
  readonly accept = IMPORT_ACCEPT;
  readonly tableSpec = EMPLOYEE_TABLE_SPEC;
  /** 読んだファイル。見出しがうちと違えば「列を合わせる」画面を出す（mapping が true の間） */
  readonly loaded = signal<{ fileName: string; encoding: CsvEncoding | null; tables: SheetTable[] } | null>(null);
  readonly mapping = signal(false);
  readonly preview = signal<Preview | null>(null);
  readonly errorKey = signal<string | null>(null);
  readonly saving = signal(false);
  readonly progress = signal<{ done: number; total: number } | null>(null);
  readonly doneCount = signal<number | null>(null);
  /** 従業員は登録できたが、マイナンバーを保管できなかった人数 */
  readonly myNumberFailed = signal(0);
  /** 確認画面：マイナンバーが入っている人数 */
  readonly myNumberCount = computed(() => this.preview()?.plan.items.filter((it) => it.myNumber).length ?? 0);

  // ===== マイナンバーの書き出し（パスワードで確かめ直してから。関数が記録を残す） =====
  readonly exportOpen = signal(false);
  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);
  readonly exportDone = signal<number | null>(null);
  /** 登録済みの従業員へのマイナンバーの取り込み */
  readonly numberRead = signal<(MyNumberImportRead & { fileName: string }) | null>(null);
  readonly numberSaving = signal(false);
  readonly numberError = signal<string | null>(null);
  readonly numberDone = signal<number | null>(null);

  // ===== エラーの直し方（11/13）：少なければ画面の中で、多ければエラーの行だけ書き出して Excel で =====
  private readonly transloco = inject(TranslocoService);
  /** 画面で直した値（'行|列' → 値）。「直した内容で確かめ直す」で表に入れて読み直す */
  readonly edits = signal<Map<string, string>>(new Map());
  /** エラーのない行だけ取り込む（エラーの行は、あとで直して取り込み直す） */
  readonly skipErrors = signal(false);
  readonly manyErrors = computed(() => this.rowErrors().reduce((n, r) => n + r.errors.length, 0) > INLINE_FIX_LIMIT);

  editKey(line: number, column: string): string {
    return `${line}|${column}`;
  }

  editValue(r: EmployeeCsvRow, e: CsvRowError): string {
    return e.column ? (this.edits().get(this.editKey(r.line, e.column)) ?? this.cellOf(r, e)) : '';
  }

  setEdit(line: number, column: string, value: string): void {
    this.edits.update((m) => new Map(m).set(this.editKey(line, column), value));
  }

  /** 直した値を表に入れて、確認をやり直す */
  async applyEdits(): Promise<void> {
    const p = this.preview();
    if (!p || this.edits().size === 0) return;
    const table = p.table.map((row) => [...row]);
    const header = table[0];
    for (const [k, value] of this.edits()) {
      const [lineText, column] = k.split('|');
      const row = table[Number(lineText) - 1];
      if (!row) continue;
      const label = EMPLOYEE_CSV_HEADERS[column as keyof typeof EMPLOYEE_CSV_HEADERS];
      let j = header.findIndex((h) => h.replace(/^\uFEFF/, '').trim() === label || h.trim() === column);
      if (j < 0) {
        // 表にない列（任意の列を使っていなかった）は、右に足す
        header.push(label);
        j = header.length - 1;
      }
      while (row.length <= j) row.push('');
      row[j] = value;
    }
    this.edits.set(new Map());
    await this.showPreview(table);
  }

  /** エラーの行だけを書き出す（右端に「エラー」の列。Excel で直して、そのファイルを取り込み直す） */
  exportErrorRows(): void {
    const p = this.preview();
    if (!p) return;
    const t = (key: string) => this.transloco.translate(key);
    const header = [...p.table[0], t('employeeCsv.errorColumn')];
    const rows = this.rowErrors().map((r) => {
      const msg = r.errors
        .map((e) => {
          const what = e.code.startsWith('contract.') ? t('contract.error.' + e.code.slice(9)) : t('employeeCsv.rowError.' + e.code);
          return e.column ? `${this.columnLabel(e.column)}：${what}` : what;
        })
        .join(' ／ ');
      return [...(p.table[r.line - 1] ?? []), msg];
    });
    downloadCsv(`employees-errors-${todayLocal()}.csv`, [header, ...rows]);
  }

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
      (this.rowErrors().length === 0 || this.skipErrors()) &&
      (p.plan.errors.length === 0 || this.skipErrors()) &&
      p.plan.items.length > 0
    );
  });
  readonly reasonParams = reasonParams;
  /** 事業所の所定労働時間がまだ → 区分を判定できず、全員が「加入しない」で入ってしまう */
  readonly noStandard = computed(() => !this.context.current()?.standardHours);
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
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // 同じファイルを選び直しても反応するように
    if (!file) return;
    this.reset();
    try {
      const { tables, encoding } = await readTables(file);
      this.loaded.set({ fileName: file.name, encoding, tables });
      const [first] = tables;
      // うちのひな形のままなら、今までどおり確認画面へ。PDF は読み取りを確かめるため、いつも列を合わせる画面を通す
      if (tables.length === 1 && !first.pdf && isOurFormat(first.rows[0], EMPLOYEE_IMPORT_FIELDS)) {
        await this.showPreview(first.rows);
      } else {
        this.mapping.set(true);
      }
    } catch (err) {
      console.error(err);
      this.errorKey.set(
        err instanceof ImportFileError ? `importMap.error.${err.code}` : 'employeeCsv.error.read',
      );
    }
  }

  /** 列を合わせ終わった（うちの見出しの表になった） */
  async onMapped(table: string[][]): Promise<void> {
    this.mapping.set(false);
    await this.showPreview(table);
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
    this.errorKey.set(null);
  }

  /** うちの見出しの表 → 読み取り・取り込みの計画（今までの確認画面） */
  private async showPreview(table: string[][]): Promise<void> {
    const office = this.context.current();
    const file = this.loaded();
    if (!office || !file) return;
    try {
      const [existing, criteria, gradeTables] = await Promise.all([
        this.employeesApi.list(office.id),
        this.criteriaApi.list(),
        this.rates.grades(),
      ]);
      const read = readEmployeeCsv(table);
      const plan = planImport(read.rows, {
        office: {
          standardHours: office.standardHours ?? null,
          specificApplication: office.specificApplication,
        },
        criteria,
        gradeTables,
        existingNumbers: new Set(existing.map((e) => e.employeeNumber ?? '').filter(Boolean)),
        departments: office.departments ?? [],
      });
      this.preview.set({ fileName: file.fileName, encoding: file.encoding, read, plan, table });
      this.skipErrors.set(false);
    } catch (err) {
      console.error(err);
      this.errorKey.set('employeeCsv.error.read');
    }
  }

  clear(): void {
    this.reset();
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
      const withNumber: { employeeId: string; number: string }[] = [];
      let numberFailed = 0;
      const n = await this.api.importMany(
        office.id,
        p.plan.items,
        (done) => this.progress.set({ done, total }),
        (it, employeeId) => {
          if (it.myNumber) withNumber.push({ employeeId, number: it.myNumber });
        },
      );
      // マイナンバー：従業員を作ったあと、関数でまとめて暗号化して保管（失敗しても従業員は登録済み）
      if (withNumber.length > 0) {
        try {
          await this.myNumbers.importMany(office.id, withNumber);
        } catch (err) {
          console.error(err);
          numberFailed = withNumber.length;
        }
      }
      this.reset();
      this.doneCount.set(n);
      this.myNumberFailed.set(numberFailed);
    } catch (err) {
      console.error(err);
      const done = this.progress()?.done ?? 0;
      this.errorKey.set(done > 0 ? 'employeeCsv.error.partial' : 'employeeCsv.error.save');
    } finally {
      this.saving.set(false);
      this.progress.set(null);
    }
  }

  /** 社員番号とマイナンバーのファイルを読む（登録済みの従業員に入れる） */
  async onNumberFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const office = this.context.current();
    if (!file || !office) return;
    this.numberRead.set(null);
    this.numberError.set(null);
    this.numberDone.set(null);
    try {
      const [{ tables }, employees] = await Promise.all([readTables(file), this.employeesApi.list(office.id)]);
      this.numberRead.set({ fileName: file.name, ...readMyNumberTable(tables[0]?.rows ?? [], employees) });
    } catch (err) {
      console.error(err);
      this.numberError.set(err instanceof ImportFileError ? `importMap.error.${err.code}` : 'employeeCsv.error.read');
    }
  }

  async saveNumbers(): Promise<void> {
    const office = this.context.current();
    const r = this.numberRead();
    if (!office || !r || r.items.length === 0 || this.numberSaving()) return;
    this.numberSaving.set(true);
    this.numberError.set(null);
    try {
      const n = await this.myNumbers.importMany(
        office.id,
        r.items.map(({ employeeId, number }) => ({ employeeId, number })),
      );
      this.numberRead.set(null);
      this.numberDone.set(n);
    } catch (err) {
      console.error(err);
      this.numberError.set(`myNumber.reason.${myNumberReason(err)}`);
    } finally {
      this.numberSaving.set(false);
    }
  }

  /** 登録済みの人の番号を CSV で（社員番号・氏名・マイナンバー） */
  async exportMyNumbers(): Promise<void> {
    const office = this.context.current();
    if (!office || this.exporting()) return;
    this.exporting.set(true);
    this.exportError.set(null);
    this.exportDone.set(null);
    try {
      const [rows, employees] = await Promise.all([this.myNumbers.exportAll(office.id), this.employeesApi.list(office.id)]);
      downloadCsv(`my-numbers-${todayLocal()}.csv`, myNumberCsv(rows, employees));
      this.exportDone.set(rows.length);
      this.exportOpen.set(false);
    } catch (err) {
      console.error(err);
      this.exportError.set(`myNumber.reason.${myNumberReason(err)}`);
    } finally {
      this.exporting.set(false);
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
