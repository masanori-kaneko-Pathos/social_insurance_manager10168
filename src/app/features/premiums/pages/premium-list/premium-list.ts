import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MonthPicker } from '../../../../shared/components/month-picker/month-picker';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { map } from 'rxjs';
import { Employee } from '../../../../core/models/employee';
import { Office } from '../../../../core/models/office';
import { OfficeTotal, PremiumPart } from '../../../../core/models/premium';
import { RemunerationDoc } from '../../../../core/models/remuneration';
import { todayLocal, shiftMonth, toYearMonth, YearMonth } from '../../../../shared/utils/date';
import { EmployeeService } from '../../../employees/employee.service';
import { RemunerationService } from '../../../employees/remuneration.service';
import { OfficeContext } from '../../../office/office-context.service';
import {
  DEFAULT_PAYROLL,
  DEFAULT_PREMIUM,
  deductionPayMonth,
  everKumiai,
  insurerFor,
  payrollOf,
  premiumOf,
  ratesForOffice,
} from '../../../office/office-settings';
import { noRates, pickRates, RateTables } from '../../../rates/logic/pick-rates';
import { RateService } from '../../../rates/rate.service';
import { healthPartTotals, officeTotals } from '../../logic/premium-core';
import { buildPremiumRow, PremiumRow } from '../../logic/premium-rows';
import { PremiumBreakdown } from '../../components/premium-breakdown/premium-breakdown';
import { Pager } from '../../../../shared/components/pager/pager';
import { PersonListBar } from '../../../../shared/components/person-list-bar/person-list-bar';
import { defaultListOptions, filterAndSort, pageOf, PersonListOptions } from '../../../../shared/logic/person-list';
import { formatMilli } from '../../logic/rounding';
import { BonusPayment } from '../../../../core/models/bonus';
import { BonusService } from '../../bonus.service';
import { addTotals, collectBonusResults } from '../../logic/bonus-rows';
import { downloadCsv, safeFileName } from '../../../../shared/csv/csv';
import { downloadXlsx } from '../../../../shared/xlsx/download-xlsx';
import { Payroll } from '../../../../core/models/payroll';
import { PayrollService } from '../../../payrolls/payroll.service';
import { advanceAmount, advanceState } from '../../logic/advance';
import { checkNotice, DIFF_REASONS, DiffReason, dueDateOf, NOTICE_CATEGORIES, NoticeCategory, noticeArrivalOf } from '../../logic/notice-check';
import { PremiumNoticeService } from '../../premium-notice.service';
import { ReviewBox } from '../../../reviews/components/review-box/review-box';
import { noticeReviewId } from '../../../reviews/logic/review';
import { PremiumNotice } from '../../../../core/models/premium-notice';
import { parseNat } from '../../../../shared/utils/number';
import { ColumnMapper } from '../../../../shared/components/column-mapper/column-mapper';
import { IMPORT_ACCEPT, ImportFileError, readTables, SheetTable } from '../../../../shared/import/parse';
import { AppDeduction, compareDeductions, CompareRow, DEDUCTION_TABLE_SPEC, softwareExportRows } from '../../logic/payroll-software';
import { buildPremiumCsv, PremiumCsvRow, premiumFileName } from '../../logic/premium-csv';
import {
  DEFAULT_PREMIUM_SORT,
  nextSort,
  PremiumSort,
  PremiumSortKey,
  sortPremiumRows,
  standardView,
  StandardView,
} from '../../logic/premium-list-view';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

interface ListItem extends PremiumRow {
  employee: Employee;
}

@Component({
  selector: 'app-premium-list',
  imports: [ColumnMapper, MonthPicker, Pager, PersonListBar, PremiumBreakdown, ReviewBox, RouterLink, TranslocoPipe],
  templateUrl: './premium-list.html',
  styleUrl: './premium-list.css',
})
export class PremiumList {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly employeesApi = inject(EmployeeService);
  private readonly remApi = inject(RemunerationService);
  private readonly rates = inject(RateService);
  private readonly bonusApi = inject(BonusService);
  private readonly payrollApi = inject(PayrollService);
  private readonly noticeApi = inject(PremiumNoticeService);
  private readonly transloco = inject(TranslocoService);
  readonly context = inject(OfficeContext);

  readonly thisMonth = toYearMonth(todayLocal());
  /** 保険料の計算方法・給与の設定（事業所の設定） */
  readonly options = computed(() => {
    const office = this.context.current();
    return office ? premiumOf(office) : DEFAULT_PREMIUM;
  });
  readonly payroll = computed(() => {
    const office = this.context.current();
    return office ? payrollOf(office) : DEFAULT_PAYROLL;
  });

  /** 見ている月（URL の ?month= から。なければ・読めなければ今月） */
  readonly month = toSignal(
    this.route.queryParamMap.pipe(
      map((p) => {
        const m = p.get('month');
        return m && MONTH.test(m) ? m : this.thisMonth;
      }),
    ),
    { initialValue: this.thisMonth },
  );

  /** 1人ごとの行に拠出金の列を出すか（URL の ?contribution=1。初期値は出さない） */
  readonly showContribution = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('contribution') === '1')),
    { initialValue: false },
  );

  /** 本人負担の「健康保険等」を、健保・介護・支援金の3列に分けて見せるか（URL の ?parts=1） */
  readonly showParts = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('parts') === '1')), {
    initialValue: false,
  });

  /** 計算の根拠を開いている人（行の下に開く。1人ずつ） */
  readonly openId = signal<string | null>(null);

  toggleOpen(id: string): void {
    this.openId.update((cur) => (cur === id ? null : id));
  }

  /** 内訳の3列 */
  readonly healthPartKeys: readonly PremiumPart[] = ['health', 'care', 'childSupport'];

  /** 表の列の数（行の下に開く欄・説明の行の colspan） */
  readonly colCount = computed(() => 9 + (this.showContribution() ? 1 : 0) + (this.showParts() ? 3 : 0));

  /**
   * 本人負担の内訳（1つの保険の分）
   * 合算して端数処理する事業所では、保険ごとの額は決まらないので、端数処理の前の額（銭まで）を参考に出す
   */
  partEmployee(r: PremiumRow, part: PremiumPart): string {
    for (const g of r.result?.groups ?? []) {
      const line = g.lines.find((l) => l.part === part);
      if (!line) continue;
      return g.lines.length === 1 ? this.yen(g.employeeYen) : formatMilli(line.employeeMilli);
    }
    return '—';
  }

  toggleParts(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { parts: this.showParts() ? null : 1 },
      queryParamsHandling: 'merge',
    });
  }

  // ===== 箱 =====
  private readonly employees = signal<Employee[]>([]);
  private readonly remunerations = signal<Map<string, RemunerationDoc[]>>(new Map());
  private readonly tables = signal<RateTables | null>(null);
  private readonly bonusPayments = signal<BonusPayment[]>([]);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);

  /** 全員分の行（月・データが変わると自動で計算し直す） */
  private readonly allRows = computed<ListItem[]>(() => {
    const tables = this.tables();
    const office = this.context.current();
    if (!tables || !office) return [];
    const month = this.month();
    const options = this.options();
    // その月の保険者・都道府県で料率を選ぶ（移転や組合健保への切り替えの前の月は、前の料率）
    const ratesFor = (m: YearMonth) => {
      const insurer = insurerFor(office, m);
      return insurer ? pickRates(insurer, tables, m) : noRates(m);
    };
    return this.employees().map((employee) => ({
      employee,
      ...buildPremiumRow({
        month,
        employee,
        remunerations: this.remunerations().get(employee.id) ?? [],
        ratesFor,
        options,
      }),
    }));
  });

  /** 表に出す人（その月に加入していない人は隠す） */
  readonly rows = computed(() => this.allRows().filter((r) => r.state !== 'none'));
  readonly hiddenCount = computed(() => this.allRows().length - this.rows().length);

  /** 並べ替え（見出しを押す。月を変えても並びはそのまま） */
  readonly sort = signal<PremiumSort>(DEFAULT_PREMIUM_SORT);
  /** 探す・絞る（従業員の一覧と同じ条件）・ページ。合計は絞り込みに関係なく全員分（11/13） */
  readonly listOptions = signal<PersonListOptions>(defaultListOptions());
  readonly page = signal(1);
  readonly filteredRows = computed(() =>
    sortPremiumRows(
      filterAndSort(this.rows(), this.listOptions(), (r) => r.employee, () => null, () => false),
      this.sort(),
    ),
  );
  private readonly shown = computed(() => pageOf(this.filteredRows(), this.page(), this.listOptions().size));
  readonly sortedRows = computed(() => this.shown().rows);

  sortBy(key: PremiumSortKey): void {
    this.sort.update((cur) => nextSort(cur, key));
  }

  /** 読み上げ用（表の見出しの aria-sort） */
  ariaSort(key: PremiumSortKey): 'ascending' | 'descending' | null {
    const s = this.sort();
    return s.key === key ? (s.dir === 'asc' ? 'ascending' : 'descending') : null;
  }

  arrow(key: PremiumSortKey): string {
    const s = this.sort();
    return s.key === key ? (s.dir === 'asc' ? '▲' : '▼') : '';
  }

  standardOf(r: ListItem): StandardView {
    return standardView(r.health, r.pension);
  }

  /** 計算できなかった人（表の上に警告として出す） */
  readonly problems = computed(() =>
    this.rows().filter((r) => r.state === 'missing' || r.state === 'error'),
  );

  /** 事業所の合計（計算できた人だけ） */
  readonly totals = computed<OfficeTotal[]>(() =>
    officeTotals(this.rows().flatMap((r) => (r.state === 'ok' && r.result ? [r.result] : []))),
  );

  /** 健康保険料の内訳（健康保険・介護保険・子ども・子育て支援金の全額） */
  readonly healthParts = computed(() =>
    healthPartTotals(this.rows().flatMap((r) => (r.state === 'ok' && r.result ? [r.result] : []))),
  );

  /** 納付額の合計（納入告知書と照らし合わせる用） */
  readonly grandTotalYen = computed(() => this.totals().reduce((s, t) => s + t.totalYen, 0));
  /** 本人負担・会社負担の総合計 */
  readonly employeeTotalYen = computed(() => this.totals().reduce((s, t) => s + t.employeeYen, 0));
  readonly employerTotalYen = computed(() => this.totals().reduce((s, t) => s + t.employerYen, 0));

  /**
   * 部署ごとの小計（部署があるときだけ）。経理が部門ごとの人件費に配る目安
   * 会社負担は事業所全体でしか決まらないので、部署ごとに同じ計算（全額の切り捨て − 本人負担）をした目安
   */
  readonly deptTotals = computed(() => {
    const depts = this.context.current()?.departments ?? [];
    if (depts.length === 0) return [];
    const groups = new Map<string, ListItem[]>();
    for (const r of this.rows()) {
      if (r.state !== 'ok' || !r.result) continue;
      const id = r.employee.org?.departmentId ?? '';
      const key = depts.some((d) => d.id === id) ? id : '';
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const order = [...depts.map((d) => ({ id: d.id, name: d.name })), { id: '', name: null as string | null }];
    return order
      .filter((d) => groups.has(d.id))
      .map((d) => {
        const list = groups.get(d.id)!;
        const t = officeTotals(list.map((r) => r.result!));
        return {
          id: d.id,
          name: d.name,
          count: list.length,
          employeeYen: t.reduce((s, x) => s + x.employeeYen, 0),
          employerYen: t.reduce((s, x) => s + x.employerYen, 0),
          totalYen: t.reduce((s, x) => s + x.totalYen, 0),
        };
      });
  });

  readonly changedCount = computed(() => this.rows().filter((r) => r.changes.length > 0).length);

  /**
   * その月に払った賞与があるときだけ「月額・賞与・合計」を出す（ない月は null）
   * 1人の本人負担は月額と賞与を別々に端数処理して足す（日本年金機構の説明）。
   * 納付額も月額・賞与それぞれで切り捨てて足すので、告知書と1円違うことがある
   */
  readonly bonusSummary = computed(() => {
    const tables = this.tables();
    const office = this.context.current();
    const month = this.month();
    const payments = this.bonusPayments();
    if (!tables || !office || !payments.some((p) => p.paidDate.startsWith(month))) return null;
    const c = collectBonusResults(
      this.employees(),
      payments,
      { ratesFor: ratesForOffice(office, tables), options: this.options() },
      (d) => d.startsWith(month),
    );
    const bonus = officeTotals(c.results);
    return {
      rows: [
        { key: 'monthly', totals: this.totals() },
        { key: 'bonus', totals: bonus },
        { key: 'sum', totals: addTotals(this.totals(), bonus) },
      ],
      problemCount: c.problemCount,
    };
  });

  /** 月額・賞与の表の列（見出しは1人ごとの表と同じ短い名前） */
  readonly bonusCols = [
    { category: 'health', label: 'premiumList.col.health' },
    { category: 'pension', label: 'premiumList.col.pension' },
    { category: 'childContribution', label: 'premiumList.col.contribution' },
  ] as const;

  totalOf(list: OfficeTotal[], category: OfficeTotal['category']): number {
    return list.find((t) => t.category === category)?.totalYen ?? 0;
  }

  sumOf(list: OfficeTotal[]): number {
    return list.reduce((s, t) => s + t.totalYen, 0);
  }

  constructor() {
    // 事業所が切り替わったら読み直す
    effect(() => {
      const office = this.context.current();
      if (office) this.load(office.id, office);
    });
    // 月を変えたら、その月の突き合わせの記録を読む（1件）
    effect(() => {
      const officeId = this.context.current()?.id;
      const month = this.month();
      if (officeId) this.loadNotice(officeId, month);
    });
  }

  // ===== 毎月の納付額の突き合わせ（年金事務所の告知額 ↔ アプリの合計） =====

  readonly noticeCategories = NOTICE_CATEGORIES;
  readonly noticeReviewId = noticeReviewId;
  readonly diffReasons = DIFF_REASONS;
  /** 保存済みの記録（なければ null）。読み込み中は undefined */
  private readonly savedNotice = signal<PremiumNotice | null | undefined>(undefined);
  /** 入力中の告知額（文字のまま） */
  readonly noticeText = signal<Record<NoticeCategory, string>>({ health: '', pension: '', childContribution: '' });
  readonly noticeReasons = signal<ReadonlySet<DiffReason>>(new Set());
  readonly noticeNote = signal('');
  readonly noticeSaving = signal(false);
  readonly noticeSaved = signal(false);
  readonly noticeError = signal<string | null>(null);

  private async loadNotice(officeId: string, month: string): Promise<void> {
    this.savedNotice.set(undefined);
    this.noticeSaved.set(false);
    this.noticeError.set(null);
    try {
      const n = await this.noticeApi.get(officeId, month);
      if (month !== this.month()) return; // 読んでいる間に月が変わった
      this.savedNotice.set(n);
      const t = (v: number | null | undefined) => (v == null ? '' : String(v));
      this.noticeText.set({ health: t(n?.health), pension: t(n?.pension), childContribution: t(n?.childContribution) });
      this.noticeReasons.set(new Set((n?.reasons ?? []) as DiffReason[]));
      this.noticeNote.set(n?.note ?? '');
    } catch (err) {
      console.error(err);
      this.savedNotice.set(null);
    }
  }

  /** 比べるアプリの合計：月額 ＋ その月に払った賞与 */
  private readonly appTotals = computed(() => {
    const b = this.bonusSummary();
    return b ? b.rows.find((r) => r.key === 'sum')!.totals : this.totals();
  });

  /** 入力の告知額（読めない・空は null） */
  private readonly noticeAmounts = computed(() => {
    const t = this.noticeText();
    const n = (s: string) => {
      const v = parseNat(s.replace(/[,，円\s]/g, ''));
      return v == null ? null : v;
    };
    return { health: n(t.health), pension: n(t.pension), childContribution: n(t.childContribution) };
  });

  readonly noticeCheck = computed(() => checkNotice(this.appTotals(), this.noticeAmounts(), !!this.bonusSummary()));
  readonly dueDate = computed(() => dueDateOf(this.month()));
  readonly arrival = computed(() => noticeArrivalOf(this.month()));

  setNoticeText(c: NoticeCategory, v: string): void {
    this.noticeText.update((t) => ({ ...t, [c]: v }));
    this.noticeSaved.set(false);
  }

  toggleReason(r: DiffReason): void {
    this.noticeReasons.update((s) => {
      const next = new Set(s);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
    this.noticeSaved.set(false);
  }

  async saveNotice(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || !this.context.isAdmin() || this.noticeSaving()) return;
    this.noticeSaving.set(true);
    this.noticeError.set(null);
    try {
      const a = this.noticeAmounts();
      await this.noticeApi.save(
        officeId,
        {
          month: this.month(),
          health: a.health,
          pension: a.pension,
          childContribution: a.childContribution,
          reasons: DIFF_REASONS.filter((r) => this.noticeReasons().has(r)),
          note: this.noticeNote().trim() || null,
        },
        !!this.savedNotice(),
      );
      await this.loadNotice(officeId, this.month());
      this.noticeSaved.set(true);
    } catch (err) {
      console.error(err);
      this.noticeError.set('premiumNotice.error.save');
    } finally {
      this.noticeSaving.set(false);
    }
  }

  private async load(officeId: string, office: Office): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const [employees, tables, bonusPayments] = await Promise.all([
        this.employeesApi.list(officeId),
        this.rates.tablesFor(officeId, everKumiai(office)),
        this.bonusApi.list(officeId),
      ]);
      // 報酬の履歴は従業員ごとに分かれているので、人数分を並行で読む
      const lists = await Promise.all(employees.map((e) => this.remApi.list(officeId, e.id)));
      this.remunerations.set(new Map(employees.map((e, i) => [e.id, lists[i]])));
      this.employees.set(employees);
      this.tables.set(tables);
      this.bonusPayments.set(bonusPayments);
    } catch (err) {
      console.error(err);
      this.errorKey.set('premiumList.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  // ===== 月の切り替え（URL を書き換える。再読み込みや「戻る」でも同じ月になる） =====

  shift(diff: number): void {
    this.goTo(shiftMonth(this.month(), diff));
  }

  /** 拠出金の列を出す・しまう（URL に残すので、再読み込みしても同じ見え方） */
  toggleContribution(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { contribution: this.showContribution() ? null : 1 }, // null で URL から消える
      queryParamsHandling: 'merge',
    });
  }

  goTo(month: YearMonth): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { month },
      queryParamsHandling: 'merge',
    });
  }

  // ===== 書き出し（CSV・Excel） =====

  /** 今見ている月の一覧の表（CSV と xlsx で同じ中身。画面に出ている人だけ。賞与は含まない） */
  private exportTable(): { name: string; rows: string[][] } | null {
    const office = this.context.current();
    if (!office || !this.context.isAdmin()) return null;
    const t = (key: string) => this.transloco.translate(key);
    const lang = this.transloco.getActiveLang() === 'en' ? 'en' : 'ja';
    const rows: PremiumCsvRow[] = this.rows().map((r) => ({
      employeeNumber: r.employee.employeeNumber ?? null,
      name: `${r.employee.lastName} ${r.employee.firstName}`,
      state: r.state as PremiumCsvRow['state'],
      health: r.health ?? null,
      pension: r.pension ?? null,
      care: !!r.care,
      healthEmployeeYen: r.healthEmployeeYen,
      pensionEmployeeYen: r.pensionEmployeeYen,
      employeeYen: r.result?.employeeYen ?? 0,
      employerMilli: r.premiumEmployerMilli,
      totalMilli: r.premiumTotalMilli,
      contributionMilli: r.contributionMilli,
      note:
        r.state === 'ok' ? '' : r.state === 'exempt' ? t('premium.exempt') : t(this.missingKey(r)),
    }));
    const totals = this.totals().map((x) => ({
      label: t(`premiumList.category.${x.category}`),
      totalYen: x.totalYen,
      employeeYen: x.employeeYen,
      employerYen: x.employerYen,
    }));
    return {
      name: safeFileName(premiumFileName(office.name, this.month(), todayLocal(), lang)),
      rows: buildPremiumCsv(rows, totals, lang),
    };
  }

  exportCsv(): void {
    const x = this.exportTable();
    if (x) downloadCsv(x.name, x.rows);
  }

  /** Excel（xlsx）：数字は数値のセル（そのまま足し算・並べ替えができる） */
  async exportXlsx(): Promise<void> {
    const x = this.exportTable();
    if (!x) return;
    try {
      await downloadXlsx(x.name.replace(/\.csv$/, '.xlsx'), this.month(), x.rows);
    } catch (err) {
      console.error(err);
    }
  }

  // ===== 給与ソフトとの役割分担（天引きの計算は給与ソフト。ここは材料を渡し、控除額を検算する） =====

  /** 計算できた人・免除の人（給与ソフトに渡す・比べる相手） */
  private readonly softwareTargets = computed(() => this.rows().filter((r) => r.state === 'ok' || r.state === 'exempt'));

  /** 給与ソフト向け CSV：等級・標準報酬月額・介護の有無・本人負担の目安 */
  exportForSoftware(): void {
    const office = this.context.current();
    if (!office || !this.context.isAdmin()) return;
    const rows = softwareExportRows(
      this.softwareTargets().map((r) => ({
        employeeNumber: r.employee.employeeNumber ?? null,
        name: `${r.employee.lastName} ${r.employee.firstName}`,
        healthStandard: r.health?.standard ?? null,
        pensionStandard: r.pension?.standard ?? null,
        care: !!r.care,
        healthEmployeeYen: r.healthEmployeeYen,
        pensionEmployeeYen: r.pension ? r.pensionEmployeeYen : null,
      })),
      this.month(),
      this.payMonth(),
    );
    const label = this.transloco.translate('payrollSoft.fileLabel');
    downloadCsv(safeFileName(`${label}_${office.name}_${this.month()}.csv`), rows);
  }

  readonly importAccept = IMPORT_ACCEPT;
  readonly deductionSpec = DEDUCTION_TABLE_SPEC;
  /** 読んだ控除額のファイル（列を合わせている間） */
  readonly deductionFile = signal<{ name: string; tables: SheetTable[] } | null>(null);
  /** 比べた結果（どの月の一覧と比べたか） */
  readonly deductionResult = signal<{ month: string; fileName: string; rows: CompareRow[] } | null>(null);
  readonly deductionError = signal<string | null>(null);
  readonly showAllDeductions = signal(false);

  async onDeductionFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.deductionResult.set(null);
    this.deductionError.set(null);
    try {
      const { tables } = await readTables(file);
      this.deductionFile.set({ name: file.name, tables });
    } catch (err) {
      console.error(err);
      this.deductionError.set(err instanceof ImportFileError ? `importMap.error.${err.code}` : 'payrollSoft.error.read');
    }
  }

  /** 列を合わせ終わった（うちの見出しの表）→ アプリの本人負担と比べる */
  onDeductionMapped(table: string[][]): void {
    const file = this.deductionFile();
    this.deductionFile.set(null);
    const app: AppDeduction[] = this.softwareTargets().map((r) => ({
      id: r.employee.id,
      employeeNumber: r.employee.employeeNumber ?? null,
      lastName: r.employee.lastName,
      firstName: r.employee.firstName,
      healthEmployeeYen: r.healthEmployeeYen,
      pensionEmployeeYen: r.pensionEmployeeYen,
    }));
    this.showAllDeductions.set(false);
    this.deductionResult.set({ month: this.month(), fileName: file?.name ?? '', rows: compareDeductions(table, app) });
  }

  cancelDeduction(): void {
    this.deductionFile.set(null);
  }

  closeDeduction(): void {
    this.deductionResult.set(null);
  }

  /** 表に出す行（初期は差がある人・照合できない人だけ） */
  readonly deductionRows = computed(() => {
    const r = this.deductionResult();
    if (!r) return [];
    return this.showAllDeductions() ? r.rows : r.rows.filter((x) => x.status !== 'match');
  });
  readonly deductionMatchCount = computed(() => this.deductionResult()?.rows.filter((x) => x.status === 'match').length ?? 0);

  nameOf(row: CompareRow): string {
    return row.employee ? `${row.employee.lastName} ${row.employee.firstName}` : row.label;
  }

  // ===== 表示の小道具 =====

  /** 何月に支払う給与から控除するか */
  readonly payMonth = computed(() => deductionPayMonth(this.month(), this.payroll()));

  // ===== 保険料の立替（ボタンを押したときだけ、控除する支払月の給与を読む） =====

  /** 確かめた支払月と、その月の給与（従業員ID → 実績） */
  private readonly advanceChecked = signal<{ payMonth: string; payrolls: Map<string, Payroll> } | null>(null);
  readonly advanceBusy = signal(false);
  /** 今見ている月で確かめ済みか（月を変えたら、もう一度押す） */
  readonly advanceReady = computed(() => this.advanceChecked()?.payMonth === this.payMonth());

  /** 立替が要りそうな人（従業員ID → 立て替える額の目安） */
  readonly advances = computed(() => {
    const c = this.advanceChecked();
    const out = new Map<string, number>();
    if (!c || c.payMonth !== this.payMonth()) return out;
    for (const r of this.rows()) {
      if (r.state !== 'ok' || !r.result) continue;
      const p = c.payrolls.get(r.employee.id) ?? null;
      if (advanceState(p, r.result.employeeYen) === 'needed') out.set(r.employee.id, advanceAmount(p!, r.result.employeeYen));
    }
    return out;
  });
  /** 給与の実績がなくて判断できなかった人の数 */
  readonly advanceUnknown = computed(() => {
    const c = this.advanceChecked();
    if (!c || c.payMonth !== this.payMonth()) return 0;
    return this.rows().filter((r) => r.state === 'ok' && r.result && advanceState(c.payrolls.get(r.employee.id) ?? null, r.result.employeeYen) === 'unknown').length;
  });

  /** 立替の確認をしまう（絞り込みのパネルのチェックを外したとき。11/13） */
  clearAdvance(): void {
    this.advanceChecked.set(null);
  }

  async checkAdvance(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || this.advanceBusy()) return;
    this.advanceBusy.set(true);
    try {
      const payMonth = this.payMonth();
      const ids = this.rows().filter((r) => r.state === 'ok').map((r) => r.employee.id);
      this.advanceChecked.set({ payMonth, payrolls: await this.payrollApi.month(officeId, ids, payMonth) });
    } catch (err) {
      console.error(err);
    } finally {
      this.advanceBusy.set(false);
    }
  }

  /** 二以上の事業所に勤務する人がいるか（表の下に注意を出す） */
  readonly hasMultipleOffices = computed(() => this.rows().some((r) => r.employee.multipleOffices));

  monthParts(month: YearMonth): { y: string; m: string } {
    return { y: month.slice(0, 4), m: String(Number(month.slice(5))) };
  }

  missingKey(r: ListItem): string {
    if (r.state === 'error') return 'premium.error.calc';
    return `premium.missing.${r.result?.missing[0]?.reason ?? 'noRate'}`;
  }

  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  readonly milli = formatMilli;
}
