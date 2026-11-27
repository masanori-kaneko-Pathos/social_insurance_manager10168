import { LeaveImport } from '../../components/leave-import/leave-import';
import { OpenRow } from '../../../../shared/components/import-issues/open-row';
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
  ImportWarning,
  ImportPlan,
  nextEmployeeNumber,
  planImport,
  readEmployeeCsv,
  RELATED_COLUMNS,
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
import type { ContactDoc, Employee, RegisterDoc } from '../../../../core/models/employee';
import { countGaps, registerGaps, registerLarge } from '../../logic/labor-register';
import { RemunerationService } from '../../remuneration.service';
import { employeeExportRow } from '../../logic/employee-export';
import {
  ChangeItem,
  changeTab,
  PersonChange,
  samePersonChanges,
  SamePersonFile,
  samePersonUpdate,
} from '../../logic/same-person-import';
import type { FilingTaskInput } from '../../../../core/models/filing-task';
import { watchUnsaved } from '../../../../shared/services/unsaved-changes';
import { EntryChoice, EntryChoiceItem } from '../../../../shared/components/entry-choice/entry-choice';
import type { IconName } from '../../../../shared/components/icon/icon';
import { EMPLOYEE_FIX_FIELDS } from '../../logic/import-fix-fields';
import { IssueCol, IssueRow } from '../../../../shared/components/import-issues/issue-row';
import { ImportSteps } from '../../../../shared/components/import-steps/import-steps';
import { PersonName } from '../../../../shared/components/person-name/person-name';
import { BackLink } from '../../../../shared/components/back-link/back-link';
import { YmPipe } from '../../../../shared/pipes/ym.pipe';

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
  | 'overseas'
  | 'leaves';
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
  'leaves',
];

/**
 * 区分を選ぶ画面のまとまり（11/27）：給与・賞与 → 従業員 → 履歴 の順（よく使うものが上）
 * 名前は importPage.group.<key>、カードの説明は importPage.card.<区分>
 */
export const IMPORT_GROUPS: readonly { key: string; modes: readonly ImportMode[] }[] = [
  { key: 'pay', modes: ['payrolls', 'bonuses'] },
  { key: 'employees', modes: ['employees', 'dependents', 'myNumber'] },
  { key: 'history', modes: ['contract', 'remuneration', 'leaves', 'certificate', 'overseas'] },
];

const MODE_ICON: Record<ImportMode, IconName> = {
  payrolls: 'payroll',
  bonuses: 'bonus',
  employees: 'people',
  dependents: 'userPlus',
  myNumber: 'admin',
  contract: 'pencil',
  remuneration: 'revision',
  certificate: 'filing',
  overseas: 'filing',
  leaves: 'calendar',
};

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
  imports: [LeaveImport, OpenRow, EntryChoice, YmPipe, BackLink, PersonName, IssueRow, ImportSteps, ImportPicker, PayrollImport, BonusImport, AbroadImport, ColumnMapper, DependentImport, HistoryImport, ImportIssues, PasswordGate, RouterLink, TranslocoPipe],
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

  /**
   * ファイルの取り込みのページ（11/17）：?kind=payrolls などで区分を選んだ状態で開く（古い ?mode= も読む）
   * 古い URL（employees/import・payrolls/import）は、ルートの data で区分と戻り先を決める
   */
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  /** 取り込む区分。null は区分を選ぶ画面（サイドバー・ホームから来たとき。11/27） */
  readonly mode = signal<ImportMode | null>(this.firstMode());
  /** 戻る（来た画面があるときだけ） */
  readonly back = (() => {
    const q = this.route.snapshot.queryParamMap;
    const from = q.get('from') ?? (this.route.snapshot.data['from'] as string | undefined) ?? '';
    return FROM[from] ?? null;
  })();
  /** 区分ごとの説明 */
  readonly leadKey = computed(() => `importPage.lead.${this.mode()}`);

  /** 区分を選ぶ画面のカード（押すと ?kind= を付けて同じページで開く。来た画面 ?from= は残す） */
  readonly groups = computed(() => {
    const id = this.context.current()?.id;
    const from = this.route.snapshot.queryParamMap.get('from');
    return IMPORT_GROUPS.map((g) => ({
      key: g.key,
      items: g.modes.map(
        (m): EntryChoiceItem => ({
          icon: MODE_ICON[m],
          titleKey: `historyCsv.mode.${m}`,
          noteKey: `importPage.card.${m}`,
          link: ['/o', id, 'import'],
          queryParams: from ? { kind: m, from } : { kind: m },
        }),
      ),
    }));
  });

  /** ?kind= がなければ区分を選ぶ画面（11/27。前は従業員の区分で開いていた） */
  private firstMode(): ImportMode | null {
    const q = this.route.snapshot.queryParamMap;
    const want = q.get('kind') ?? q.get('mode') ?? (this.route.snapshot.data['kind'] as string | undefined) ?? '';
    return (IMPORT_MODES as readonly string[]).includes(want) ? (want as ImportMode) : null;
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
    const want = q.get('kind') ?? q.get('mode');
    if (want && want !== this.mode() && (IMPORT_MODES as readonly string[]).includes(want)) {
      this.doneCount.set(null);
      this.mode.set(want as ImportMode);
    }
    // ?kind= が消えたら（ブラウザの戻る・サイドバーから開き直し）区分を選ぶ画面へ（11/27）
    if (!want && !this.route.snapshot.data['kind'] && this.mode() !== null) this.mode.set(null);
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
  private readonly remunerationsApi = inject(RemunerationService);
  /** エラーのない行だけ取り込む（エラーの行は、あとで直して取り込み直す） */
  readonly skipErrors = signal(true); // 問題の行は、行のチェックが外れて取り込まない（11/17）
  // ===== 行ごとのチェック（11/17）：外した行は取り込まない =====
  private readonly fixRef = viewChild(ImportIssues);
  private kept(line: number): boolean {
    return !(this.fixRef()?.excluded().has(line) ?? false);
  }
  /** 問題の行：表の列ごとに、ファイルのどの列の値を出すか（取り込んだときと同じ並び・同じ書き方。11/18） */
  readonly issueCols: readonly IssueCol[] = (() => {
    const h = EMPLOYEE_CSV_HEADERS;
    return [
      [h.employeeNumber],
      [[h.lastName, h.firstName], [h.lastNameKana, h.firstNameKana]],
      [h.department],
      [h.birthDate],
      [h.hireDate, { hs: [h.retireDate], pre: '〜' }],
      [{ hs: [h.employmentType, h.payType], sep: '・' }, { hs: [h.weeklyHours, h.monthlyDays], sep: '／' }],
      [{ hs: [h.healthEnrolled, h.pensionEnrolled], sep: '・' }],
      [h.remunerationFrom, h.monthlyAmount],
      [[h.leave1Kind, h.leave2Kind]],
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
      // 2つの欄を比べるエラーは、両方の欄を直せるように出す（11/27）
      headers: [
        ...new Set(r.errors.flatMap((e) => (RELATED_COLUMNS[e.code] ?? (e.column ? [e.column] : [])).map((c) => this.columnLabel(c)))),
      ],
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

  /** 登録済みの同じ人：CSVによる変更点（行ごとに「変更する／変更しない」を選ぶ。11/25） */
  readonly samePeople = signal<SamePersonRow[]>([]);
  readonly changedPeople = computed(() => this.samePeople().filter((x) => x.diffs.length > 0));
  /** 選んだ値（「行番号|行のキー」→ 変更する）。選んでいない行は初期値 */
  readonly choices = signal<Record<string, boolean>>({});
  isApplied(x: SamePersonRow, d: PersonChange): boolean {
    return d.selectable && (this.choices()[`${x.line}|${d.key}`] ?? d.apply);
  }
  setApplied(x: SamePersonRow, d: PersonChange, value: string): void {
    this.choices.update((c) => ({ ...c, [`${x.line}|${d.key}`]: value === 'apply' }));
  }
  /** 「変更する」を選んだ行から、人ごとの保存するもの */
  readonly personUpdates = computed(() =>
    this.samePeople().flatMap((x) => {
      if (!x.employeeId || !x.saved) return [];
      const update = samePersonUpdate(x.saved, x.file, x.diffs.filter((d) => this.isApplied(x, d)));
      return update ? [{ employeeId: x.employeeId, saved: x.saved, update }] : [];
    }),
  );
  /** 変更する行の数 */
  readonly changeCount = computed(() => this.personUpdates().reduce((n, u) => n + u.update.count, 0));
  /** 変更した人数と、関連する届出（保存のあとに出す） */
  readonly changedCount = signal(0);
  readonly followUpsDone = signal<{ key: string; n: number }[]>([]);

  /** 取り込む人のうち、名簿の項目が空の人（取り込む前に知らせる） */
  readonly newGaps = computed(() => {
    const p = this.preview();
    if (!p) return null;
    const today = todayLocal();
    const items = this.importItems().map((it) => it.employee);
    const large = registerLarge([...this.existingForGaps(), ...items], today);
    return countGaps(items.map((e) => registerGaps(e, today, large)));
  });
  private readonly existingForGaps = signal<Employee[]>([]);
  /** 取り込んだあとの、事業所全体の名簿の記入漏れ */
  readonly gapsAfter = signal<ReturnType<typeof countGaps> | null>(null);
  /** 何の漏れが何人か → 「履歴 12・住所 12」 */
  gapText(by: Partial<Record<string, number>>): string {
    return Object.entries(by)
      .map(([k, n]) => `${this.transloco.translate('employee.register.gapShort.' + k)} ${n}`)
      .join('・');
  }

  private async countGapsAfter(officeId: string): Promise<void> {
    try {
      const [list, privates] = await Promise.all([this.employeesApi.list(officeId), this.employeesApi.listPrivates(officeId)]);
      const today = todayLocal();
      const large = registerLarge(list, today);
      this.gapsAfter.set(
        countGaps(list.map((e) => { const p = privates.get(e.id); return p ? registerGaps({ ...e, ...p }, today, large) : []; })),
      );
    } catch (err) {
      console.error(err); // 数えられなくても取り込みは済んでいる
    }
  }

  private async loadSamePeople(plan: ImportPlan, existing: readonly Employee[]): Promise<void> {
    const office = this.context.current();
    if (!office || plan.skipped.length === 0) {
      this.samePeople.set([]);
      this.choices.set({});
      return;
    }
    const byNo = new Map(existing.map((e) => [e.employeeNumber ?? '', e]));
    const today = todayLocal();
    const deptName = (id: string) => office.departments?.find((d) => d.id === id)?.name ?? null;
    const privates = await this.employeesApi.listPrivates(office.id);
    const rows = await Promise.all(
      plan.skipped.map(async (s) => {
        const saved = byNo.get(s.employeeNumber);
        const priv = saved ? privates.get(saved.id) : undefined;
        const name = `${s.employee.lastName} ${s.employee.firstName}`.trim();
        const file: SamePersonFile = { employee: s.employee, leaves: s.leaves };
        if (!saved || !priv) return { line: s.line, employeeId: null, employeeNumber: s.employeeNumber, name, saved: null, file, diffs: [] };
        const [contracts, remunerations] = await Promise.all([
          this.contractsApi.list(office.id, saved.id),
          // 報酬月額の列があるときだけ読む（資格取得時決定の記録と比べる）
          s.monthlyAmount != null ? this.remunerationsApi.list(office.id, saved.id) : Promise.resolve([]),
        ]);
        // ファイルの行も、書き出しと同じ書き方にしてから比べる（「男」「男性」「1」などの言い方の違いを消すため）
        const fileEmployee: Employee = {
          ...saved,
          ...s.employee,
          health: { ...saved.health, enrolled: s.healthOverride ?? saved.health.enrolled },
          pension: { ...saved.pension, enrolled: s.pensionOverride ?? saved.pension.enrolled },
          leaves: [],
        };
        const fileRow = employeeExportRow(
          {
            employee: fileEmployee,
            contract: s.contract,
            remunerations: s.monthlyAmount != null ? [{ from: '', reason: 'acquisition', monthlyAmount: s.monthlyAmount }] : [],
            private: { contact: s.employee.contact, register: s.employee.register },
          },
          deptName,
        );
        const savedRow = employeeExportRow(
          { employee: saved, contract: contractAt(contracts, today), remunerations, private: priv },
          deptName,
        );
        const diffs = samePersonChanges({
          values: s.values,
          fileRow,
          savedRow,
          fileLeaves: s.leaves,
          savedLeaves: saved.leaves ?? [],
          savedRetired: !!saved.retireDate,
          departmentUnknown: s.departmentUnknown,
        });
        const full = { ...saved, ...priv, leaves: saved.leaves ?? [] };
        return { line: s.line, employeeId: saved.id, employeeNumber: s.employeeNumber, name, saved: full, file, diffs };
      }),
    );
    this.choices.set({});
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
      (this.importItems().length > 0 || this.changeCount() > 0)
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
    this.samePeople.set([]);
    this.choices.set({});
    this.gapsAfter.set(null);
    this.changedCount.set(0);
    this.followUpsDone.set([]);
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
        today: todayLocal(),
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
      this.existingForGaps.set(existing);
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
      // 登録済みの同じ人：「変更する」を選んだ行だけ（変更履歴つき。11/25）
      // 住所は保存の部品が住所変更届の宿題を残す。氏名（カナ）は氏名変更届の宿題をここで作って一緒に渡す
      const updates = this.personUpdates();
      const tasks: FilingTaskInput[] = [];
      let leaveFollowUps: string[] = [];
      for (const u of updates) {
        const extra = u.update.followUps.includes('name')
          ? await this.employeesApi.nameTasksFor(office.id, { ...u.saved, id: u.employeeId }, todayLocal())
          : [];
        if (Object.keys(u.update.patch).length > 0 || extra.length > 0) {
          tasks.push(...(await this.employeesApi.update(office.id, u.employeeId, u.update.patch, undefined, extra)));
        }
        if (u.update.leaves) await this.employeesApi.updateLeaves(office.id, u.employeeId, u.update.leaves);
        leaveFollowUps = [...leaveFollowUps, ...u.update.followUps.filter((f) => f === 'maternity' || f === 'childcare')];
      }
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
      this.changedCount.set(updates.length);
      this.followUpsDone.set(countKeys([...tasks.map((t) => t.kind), ...leaveFollowUps]));
      this.myNumberFailed.set(numberFailed);
      await this.countGapsAfter(office.id);
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
  /** 加入の欄：入る保険だけ（健保・厚年／健保／厚年） */
  enrolledLabel(it: ImportItem): string {
    const t = (k: string) => this.transloco.translate(`employeeCsv.ins.${k}`);
    return [it.employee.health.enrolled ? t('health') : '', it.employee.pension.enrolled ? t('pension') : '']
      .filter(Boolean)
      .join('・');
  }
  /** 表に出す注意（「加入しない」は欄に書くので出さない。部署なしは部署の欄の「—」で分かるので出さない。11/18） */
  shownWarnings(it: ImportItem): ImportWarning[] {
    return it.warnings.filter(
      (w) => w !== 'notInsured' && w !== 'unknownDepartment' && !(w === 'sameNameBirth' && this.differentPeople().has(it.line)),
    );
  }

  /** 「同じ人では？」に「別の人」と答えた行（11/27。気づいても何もできなかったため、その場で選べるようにした） */
  readonly differentPeople = signal<ReadonlySet<number>>(new Set());
  markDifferent(line: number): void {
    this.differentPeople.update((s) => new Set(s).add(line));
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
  /** 表の「項目」（休業は1件ずつ、外国籍の情報は1行にまとめるので、列の名前ではない） */
  changeLabel(item: ChangeItem): string {
    return item === 'leave' || item === 'foreign' ? this.transloco.translate('employeeCsv.same.' + item) : this.columnLabel(item);
  }
  /** 変えない項目を直す場所（従業員の画面のタブ、または編集画面） */
  changeLink(employeeId: string, item: ChangeItem): { path: unknown[]; tab: string | null } {
    const tab = changeTab(item);
    const office = this.context.current()?.id;
    return tab
      ? { path: ['/o', office, 'employees', employeeId], tab }
      : { path: ['/o', office, 'employees', employeeId, 'edit'], tab: null };
  }
}

/** CSVによる変更点の1人分 */
interface SamePersonRow {
  line: number;
  employeeId: string | null;
  employeeNumber: string;
  name: string;
  /** 登録済みの値（読めなかったら null） */
  saved: (Employee & { contact: ContactDoc; register: RegisterDoc }) | null;
  file: SamePersonFile;
  diffs: PersonChange[];
}

/** 同じものを数える（出てきた順） */
function countKeys(keys: readonly string[]): { key: string; n: number }[] {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].map(([key, n]) => ({ key, n }));
}
