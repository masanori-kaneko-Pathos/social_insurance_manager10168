import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import { ageAt, todayLocal } from '../../../../shared/utils/date';
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
  nextEmployeeNumber,
  planImport,
  readEmployeeCsv,
} from '../../logic/employee-csv';
import { reasonParams } from '../../logic/classify';
import { DependentImport } from '../../components/dependent-import/dependent-import';
import { AbroadImport } from '../../components/abroad-import/abroad-import';
import { HistoryImport } from '../../components/history-import/history-import';
import { PayrollImport } from '../../../payrolls/pages/payroll-import/payroll-import';
import { BonusImport } from '../../../premiums/components/bonus-import/bonus-import';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { ImportPicker } from '../../../../shared/components/import-picker/import-picker';
import { ImportFix, ImportIssue, ImportIssues } from '../../../../shared/components/import-issues/import-issues';
import { applyRowValues } from '../../../../shared/import/row-fix';
import { ContractService } from '../../contract.service';
import { contractAt } from '../../logic/contract-form-model';
import { PersonDiff, samePersonDiffs } from '../../logic/employee-csv';
import type { Employee } from '../../../../core/models/employee';
import { watchUnsaved } from '../../../../shared/services/unsaved-changes';
import { EMPLOYEE_FIX_FIELDS } from '../../logic/import-fix-fields';
import { IssueRow } from '../../../../shared/components/import-issues/issue-row';
import { ImportSteps } from '../../../../shared/components/import-steps/import-steps';

/**
 * 何を取り込むか（ファイルの取り込みのページの区分。11/17 に給与の実績・マイナンバーも入れた）
 * 従業員（1行1人）／扶養家族／契約の履歴／標準報酬の履歴／給与の実績／マイナンバー／協定の適用証明書／海外勤務
 */
export type ImportMode =
  | 'employees'
  | 'dependents'
  | 'contract'
  | 'remuneration'
  | 'payrolls'
  | 'bonuses'
  | 'myNumber'
  | 'certificate'
  | 'overseas';
export const IMPORT_MODES: readonly ImportMode[] = [
  'employees',
  'dependents',
  'contract',
  'remuneration',
  'payrolls',
  'bonuses',
  'myNumber',
  'certificate',
  'overseas',
];

/** どこから来たか（戻るの行き先と名前） */
const FROM: Record<string, { path: string[]; label: string }> = {
  employees: { path: ['employees'], label: 'nav.employees' },
  payrolls: { path: ['payrolls'], label: 'payroll.listTitle' },
  bonuses: { path: ['bonuses'], label: 'nav.bonuses' },
  home: { path: [], label: 'nav.home' },
};

interface Preview {
  fileName: string;
  encoding: CsvEncoding | null; // Excel・PDF は null
  read: EmployeeCsvRead;
  plan: ImportPlan;
  /** 登録済みの社員番号（重なったときの空き番号の例を出すため。11/16） */
  existingNumbers: string[];
  /** 読んだ表（うちの見出し）。画面で直すとき・エラーの行を書き出すときに使う */
  table: string[][];
}


/**
 * 従業員の取り込み（CSV）
 * 1行 ＝ 1人 ＝ 従業員の基本 ＋ 最初の雇用契約。加入するかと標準報酬は、契約から計算して確認画面で見せる
 * エラーの行が1つでもあれば取り込まない（直してから選び直す）
 */
@Component({
  selector: 'app-employee-import',
  imports: [IssueRow, ImportSteps, ImportPicker, PayrollImport, BonusImport, AbroadImport, ColumnMapper, DependentImport, HistoryImport, ImportIssues, PasswordGate, RouterLink, TranslocoPipe],
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
  /**
   * ファイルの取り込みのページ（11/17）：?kind=payrolls などで区分を選んだ状態で開く（古い ?mode= も読む）
   * 古い URL（employees/import・payrolls/import）は、ルートの data で区分と戻り先を決める
   */
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly mode = signal<ImportMode>(this.firstMode());
  /** 戻る（来た画面があるときだけ） */
  readonly back = (() => {
    const q = this.route.snapshot.queryParamMap;
    const from = q.get('from') ?? (this.route.snapshot.data['from'] as string | undefined) ?? '';
    return FROM[from] ?? null;
  })();
  /** 区分ごとの説明 */
  readonly leadKey = computed(() => `importPage.lead.${this.mode()}`);

  private firstMode(): ImportMode {
    const q = this.route.snapshot.queryParamMap;
    const want = q.get('kind') ?? q.get('mode') ?? (this.route.snapshot.data['kind'] as string | undefined) ?? '';
    return (IMPORT_MODES as readonly string[]).includes(want) ? (want as ImportMode) : 'employees';
  }

  /** 区分を切り替える（URL にも残す。読み直しても同じ区分で開く） */
  setMode(m: ImportMode): void {
    this.doneCount.set(null);
    this.mode.set(m);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { kind: m, mode: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** 従業員を取り込んだあと「次は扶養家族」：同じ画面のまま、区分を切り替える（11/16） */
  goDependents(): void {
    this.setMode('dependents');
    window.scrollTo({ top: 0 });
  }

  /** 次は給与の実績（同じ画面のまま） */
  goPayrolls(): void {
    this.setMode('payrolls');
    window.scrollTo({ top: 0 });
  }

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
  /** 同じページのまま ?kind= が変わったとき（扶養家族の「次は給与の実績」など）も区分を合わせる */
  private readonly kindFollow = this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((q) => {
    const want = q.get('kind');
    if (want && want !== this.mode() && (IMPORT_MODES as readonly string[]).includes(want)) {
      this.doneCount.set(null);
      this.mode.set(want as ImportMode);
    }
  });

  /** 読んだのにまだ取り込んでいなければ、画面を離れる前に確かめる（11/17） */
  private readonly unsaved = watchUnsaved(() => (this.loaded() !== null || this.preview() !== null) && this.doneCount() === null);
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

  // ===== エラーの直し方（11/17）：共通の部品（app-import-issues）。「直す」の窓で1行ずつ直して、すぐ確かめ直す =====
  private readonly transloco = inject(TranslocoService);
  private readonly contractsApi = inject(ContractService);
  /** エラーのない行だけ取り込む（エラーの行は、あとで直して取り込み直す） */
  readonly skipErrors = signal(true); // 問題の行は、行のチェックが外れて取り込まない（11/17）
  // ===== 行ごとのチェック（11/17）：外した行は取り込まない =====
  private readonly fixRef = viewChild(ImportIssues);
  private kept(line: number): boolean {
    return !(this.fixRef()?.excluded().has(line) ?? false);
  }
  /** 問題の行：表の列ごとに、ファイルのどの列の値を出すか（取り込んだときと同じ並び。11/17） */
  readonly issueCols: readonly (readonly string[])[] = (() => {
    const h = EMPLOYEE_CSV_HEADERS;
    return [
      [h.employeeNumber],
      [h.lastName, h.firstName, h.lastNameKana, h.firstNameKana],
      [h.department],
      [h.birthDate],
      [h.hireDate, h.retireDate],
      [h.employmentType, h.payType, h.weeklyHours, h.monthlyDays],
      [],
      [h.healthEnrolled, h.pensionEnrolled],
      [h.monthlyAmount, h.remunerationFrom],
      [h.leave1Kind, h.leave2Kind],
    ];
  })();
  /** 取り込む人（チェックの入った行） */
  readonly importItems = computed(() => (this.preview()?.plan.items ?? []).filter((it) => this.kept(it.line)));
  /** 窓で直すときの欄の種類（プルダウン・カレンダー・数。11/17） */
  readonly fixFields = EMPLOYEE_FIX_FIELDS;

  /** エラーの行と、社員番号が重なった行（どちらも窓で直す） */
  readonly issues = computed<ImportIssue[]>(() => {
    const p = this.preview();
    if (!p) return [];
    const t = (key: string, params?: Record<string, unknown>) => this.transloco.translate(key, params);
    const out: ImportIssue[] = this.rowErrors().map((r) => ({
      line: r.line,
      headers: r.errors.filter((e) => e.column).map((e) => this.columnLabel(e.column)),
      messages: r.errors.map((e) => {
        const what = e.code.startsWith('contract.') ? t('contract.error.' + e.code.slice(9)) : t('employeeCsv.rowError.' + e.code);
        return e.column ? `${this.columnLabel(e.column)}：${what}` : what;
      }),
    }));
    const next = this.numberSuggestion();
    for (const e of p.plan.errors) {
      out.push({
        line: e.line,
        headers: [this.headers.employeeNumber],
        messages: [t('employeeCsv.dup.code.' + e.code, { number: e.employeeNumber })],
        suggestions: next ? [{ label: t('importFix.useNumber', { n: next }), values: { [this.headers.employeeNumber]: next } }] : [],
      });
    }
    return out.sort((a, b) => a.line - b.line);
  });

  /** 窓で直した1行を表に入れて、確かめ直す */
  async onFix(fix: ImportFix): Promise<void> {
    const p = this.preview();
    if (!p) return;
    await this.showPreview(applyRowValues(p.table, fix.line, fix.values));
  }

  /** 登録済みの同じ人：ファイルと違う所（取り込まない。知らせるだけ） */
  readonly samePeople = signal<{ line: number; employeeNumber: string; name: string; diffs: PersonDiff[] }[]>([]);
  readonly changedPeople = computed(() => this.samePeople().filter((x) => x.diffs.length > 0));

  private async loadSamePeople(plan: ImportPlan, existing: readonly Employee[]): Promise<void> {
    const office = this.context.current();
    if (!office || plan.skipped.length === 0) {
      this.samePeople.set([]);
      return;
    }
    const byNo = new Map(existing.map((e) => [e.employeeNumber ?? '', e]));
    const today = todayLocal();
    const rows = await Promise.all(
      plan.skipped.map(async (s) => {
        const saved = byNo.get(s.employeeNumber);
        const contracts = saved ? await this.contractsApi.list(office.id, saved.id) : [];
        const contract = contractAt(contracts, today);
        return {
          line: s.line,
          employeeNumber: s.employeeNumber,
          name: `${s.employee.lastName} ${s.employee.firstName}`.trim(),
          diffs: saved ? samePersonDiffs(s, { employee: saved, contract }) : [],
        };
      }),
    );
    this.samePeople.set(rows);
  }
  /** 空いている番号の例（登録済み・ファイルの中・画面で直した番号のどれとも重ならない） */
  readonly numberSuggestion = computed(() => {
    const p = this.preview();
    if (!p) return null;
    const inFile = p.read.rows.map((r) => r.values.employeeNumber ?? '');
    return nextEmployeeNumber([...p.existingNumbers, ...inFile]);
  });

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
      this.importItems().length > 0
    );
  });
  readonly reasonParams = reasonParams;
  /** 事業所の所定労働時間がまだ → 区分を判定できず、全員が「加入しない」で入ってしまう */
  readonly noStandard = computed(() => !this.context.current()?.standardHours);
  readonly insuredCount = computed(
    () =>
      this.importItems().filter((i) => i.employee.health.enrolled || i.employee.pension.enrolled).length,
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
      const existingNumbers = existing.map((e) => e.employeeNumber ?? '').filter(Boolean);
      const plan = planImport(read.rows, {
        office: {
          standardHours: office.standardHours ?? null,
          specificApplication: office.specificApplication,
        },
        criteria,
        gradeTables,
        existingNumbers: new Set(existingNumbers),
        existingPeople: new Map(
          existing
            .filter((e) => e.employeeNumber)
            .map((e) => [e.employeeNumber!, { lastName: e.lastName, firstName: e.firstName, birthDate: e.birthDate }]),
        ),
        departments: office.departments ?? [],
      });
      this.preview.set({ fileName: file.fileName, encoding: file.encoding, read, plan, table, existingNumbers });
      await this.loadSamePeople(plan, existing);
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'employeeCsv.error.read'));
    }
  }

  clear(): void {
    this.reset();
  }

  async importCsv(): Promise<void> {
    const office = this.context.current();
    const p = this.preview();
    if (!office || !p || !this.canImport()) return;
    const items = this.importItems();
    const total = items.length;
    this.saving.set(true);
    this.progress.set({ done: 0, total });
    this.errorKey.set(null);
    try {
      const withNumber: { employeeId: string; number: string }[] = [];
      let numberFailed = 0;
      const n = await this.api.importMany(
        office.id,
        items,
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
  kana(it: ImportItem): string {
    return `${it.employee.lastNameKana ?? ''} ${it.employee.firstNameKana ?? ''}`.trim() || '—';
  }
  /** 部署の名前（事業所の設定の部署に結べた人だけ） */
  deptName(it: ImportItem): string {
    const id = it.employee.org?.departmentId;
    return (id && this.context.current()?.departments?.find((d) => d.id === id)?.name) || '—';
  }
  age(it: ImportItem): string {
    return it.employee.birthDate ? String(ageAt(it.employee.birthDate, todayLocal())) : '—';
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
