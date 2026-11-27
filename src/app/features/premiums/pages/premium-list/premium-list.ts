import { centerOpenedRow } from '../../../../shared/utils/center-opened';
import { Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MonthPicker } from '../../../../shared/components/month-picker/month-picker';
import { EntryChoice, EntryChoiceItem } from '../../../../shared/components/entry-choice/entry-choice';
import { NgTemplateOutlet } from '@angular/common';
import { ElementRef } from '@angular/core';
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
  deductionAt,
  deductionPayMonth,
  premiumMonthsOfPay,
  everKumiai,
  insurerFor,
  payrollOf,
  premiumOf,
  insurerKeyOf, ratesForOffice,
} from '../../../office/office-settings';
import { noRates, pickRates, RateTables } from '../../../rates/logic/pick-rates';
import { withCapRevisions } from '../../../rates/logic/cap-revision';
import { RateService } from '../../../rates/rate.service';
import { employeeYenOfPart, healthPartTotals, officeTotals } from '../../logic/premium-core';
import { PREMIUM_DEFAULT_KEYS, premiumExportColumns } from '../../logic/premium-export-columns';
import { ExportDialog } from '../../../../shared/components/export-dialog/export-dialog';
import { buildPremiumRow, PremiumRow } from '../../logic/premium-rows';
import {
  categoryMilliOf,
  DeductionCause,
  deductionCauses,
  FoundCause,
  matchNotice,
  NOTICE_CAUSE_REASON,
  NoticeCandidate,
  noticeCandidates,
  NoticeCause,
  NoticePerson,
} from '../../logic/diff-causes';
import { calcMonthly } from '../../logic/calc-monthly';
import { PremiumTotals } from '../../components/premium-totals/premium-totals';
import { PremiumBreakdown } from '../../components/premium-breakdown/premium-breakdown';
import { Pager } from '../../../../shared/components/pager/pager';
import { ContractDoc } from '../../../../core/models/contract';
import { CriteriaDoc } from '../../../../core/models/master';
import { ContractService } from '../../../employees/contract.service';
import { CriteriaService } from '../../../office/criteria.service';
import { AdjustmentOffice, adjustmentForEmployee } from '../../logic/adjustment-office';
import { AdjustmentInput, refundYen } from '../../logic/premium-adjustment';
import { CloseOnOutside } from '../../../../shared/directives/close-on-outside';
import { PersonListBar } from '../../../../shared/components/person-list-bar/person-list-bar';
import { defaultListOptions, filterAndSort, listFilterCount, pageOf, PersonListOptions } from '../../../../shared/logic/person-list';
import { formatMilli } from '../../logic/rounding';
import { BonusPayment } from '../../../../core/models/bonus';
import type { BonusPremiumResult } from '../../../../core/models/premium';
import { BonusService } from '../../bonus.service';
import { bonusResultsByEmployee, collectBonusResults } from '../../logic/bonus-rows';
import { downloadCsv, safeFileName } from '../../../../shared/csv/csv';
import { downloadXlsx } from '../../../../shared/xlsx/download-xlsx';
import { Payroll } from '../../../../core/models/payroll';
import { PayrollService } from '../../../payrolls/payroll.service';
import { advanceAmount, advanceState } from '../../logic/advance';
import { checkNotice, noticeLabelKey, DIFF_REASONS, DiffReason, dueDateOf, NOTICE_CATEGORIES, NoticeCategory, noticeArrivalOf } from '../../logic/notice-check';
import { PremiumNoticeService } from '../../premium-notice.service';
import { ReviewBox } from '../../../reviews/components/review-box/review-box';
import { noticeReviewId } from '../../../reviews/logic/review';
import { Review, ReviewService } from '../../../reviews/review.service';
import type { NoticeReviewState } from '../../logic/premium-guide';
import { PremiumNotice } from '../../../../core/models/premium-notice';
import { parseNat } from '../../../../shared/utils/number';
import { ColumnMapper } from '../../../../shared/components/column-mapper/column-mapper';
import { IMPORT_ACCEPT, ImportFileError, readTables, SheetTable } from '../../../../shared/import/parse';
import {
  AppDeduction,
  compareDeductions,
  CompareRow,
  DEDUCTION_TABLE_SPEC,
  softwareExportRows,
  StandardChangeRow,
  standardChangeRows, softCheckOf } from '../../logic/payroll-software';
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
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { PersonName } from '../../../../shared/components/person-name/person-name';
import { regularPending } from '../../logic/regular-pending';
import { MonthCloseService } from '../../month-close.service';
import { MonthClose, SoftCheck } from '../../../../core/models/month-close';
import { GuideStep, StepGuide } from '../../../../shared/components/step-guide/step-guide';
import { premiumGuideSteps } from '../../logic/premium-guide';
import { SpecialInsuredMap, SpecialInsuredService } from '../../../employees/special-insured.service';
import { deductionHistoryAt, hasPayGroups, payrollAt } from '../../../office/logic/pay-group';
import {
  buildPeople,
  closeBlockers,
  closeCheck,
  CloseDiff,
  ClosePeople,
  CloseSource,
  diffsOf,
  monthDiffSummary,
  openTotals,
  peopleTotals,
  Settlement,
  settlementOf,
} from '../../logic/month-close';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

interface ListItem extends PremiumRow {
  employee: Employee;
}

@Component({
  selector: 'app-premium-list',
  imports: [PersonName, CloseOnOutside, ColumnMapper, EntryChoice, ExportDialog, MonthPicker, NgTemplateOutlet, Pager, PersonListBar, PremiumBreakdown, ReviewBox, RouterLink, TranslocoPipe, PremiumTotals, StepGuide],
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
  private readonly contractApi = inject(ContractService);
  private readonly criteriaApi = inject(CriteriaService);
  private readonly noticeApi = inject(PremiumNoticeService);
  private readonly closeApi = inject(MonthCloseService);
  private readonly reviewApi = inject(ReviewService);
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
    // 開いたら、行と根拠を画面の真ん中へ（11/27）
    if (this.openId() === id) centerOpenedRow(id);
  }

  /** 行を押したら根拠を開く・閉じる（氏名のリンク・ボタン・入力欄を押したときは何もしない。11/26） */
  rowClick(event: MouseEvent, id: string): void {
    const el = event.target as HTMLElement | null;
    if (el?.closest('a, button, input, select, textarea, label')) return;
    if (window.getSelection()?.toString()) return; // 文字を選んでいるときは開かない
    this.toggleOpen(id);
  }

  /** 行に移って Enter・スペースで開く・閉じる（行の中のリンクにいるときは、リンクのまま） */
  rowKey(event: KeyboardEvent, id: string): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.toggleOpen(id);
  }

  /** 内訳の3列 */
  readonly healthPartKeys: readonly PremiumPart[] = ['health', 'care', 'childSupport'];

  /** 表の列の数（行の下に開く欄・説明の行の colspan） */
  readonly colCount = computed(() => 9 + (this.showContribution() ? 1 : 0) + (this.showParts() ? 3 : 0));

  /**
   * 本人負担の内訳（1つの保険の分）
   * 合算して端数処理する事業所では、健保 → ＋支援金 → ＋介護 の順に端数処理した差し引きの額（円。合計は合算の額と同じ。11/24）
   */
  partEmployee(r: PremiumRow, part: PremiumPart): string {
    const y = employeeYenOfPart(r.result, part);
    return y == null ? '—' : this.yen(y);
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
  /** 保険料調整制度のための契約・加入の基準（使っている事業所だけ読む。11/16） */
  private readonly contracts = signal<Map<string, ContractDoc[]>>(new Map());
  private readonly criteria = signal<CriteriaDoc[]>([]);
  readonly loading = signal(true);

  /** 保険料調整制度の設定（使っていなければ null） */
  private readonly adjustmentOffice = computed<AdjustmentOffice | null>(() => {
    const o = this.context.current();
    if (!o?.premiumAdjustment?.since) return null;
    return { ...o, since: o.premiumAdjustment.since, standardHours: o.standardHours ?? null };
  });

  /** 特定被保険者（組合健保）：従業員ID → 「月 → 特定被保険者か」。制度を使っていなければ空（11/26） */
  private readonly special = signal<SpecialInsuredMap>(new Map());
  private readonly specialApi = inject(SpecialInsuredService);

  /** 1人分の「月 → 軽減割合」 */
  private adjustmentOf(employee: Employee): ((m: YearMonth) => AdjustmentInput | null) | undefined {
    const ao = this.adjustmentOffice();
    if (!ao) return undefined;
    return adjustmentForEmployee(
      ao,
      employee,
      this.contracts().get(employee.id) ?? [],
      this.criteria(),
      this.remunerations().get(employee.id) ?? [],
    );
  }
  readonly errorKey = signal<string | null>(null);

  /** 全員分の行（月・データが変わると自動で計算し直す） */
  private readonly allRows = computed<ListItem[]>(() => this.rowsFor(this.month()));

  /** ある月の全員分の行（今見ている月と、月次確定の差額をまとめて見るときに使う） */
  private rowsFor(month: YearMonth): ListItem[] {
    const tables = this.tables();
    const office = this.context.current();
    if (!tables || !office) return [];
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
        adjustmentFor: this.adjustmentOf(employee),
        specialInsuredFor: this.special().get(employee.id),
      }),
    }));
  }

  /**
   * 保険料調整制度：3か月前の分の軽減額（会社が多く払った分）。今月の納付額から差し引かれる（11/16）
   * 健保・厚年べつ（円。1人ごとに小数点第一位を四捨五入して足す）
   */
  readonly adjustmentRefund = computed<{ month: YearMonth; health: number; pension: number } | null>(() => {
    const ao = this.adjustmentOffice();
    const tables = this.tables();
    const office = this.context.current();
    if (!ao || !tables || !office) return null;
    const m = shiftMonth(this.month(), -3);
    const ratesFor = (x: YearMonth) => {
      const insurer = insurerFor(office, x);
      return insurer ? pickRates(insurer, tables, x) : noRates(x);
    };
    let health = 0;
    let pension = 0;
    for (const employee of this.employees()) {
      const f = this.adjustmentOf(employee);
      if (!f || !f(m)) continue;
      try {
        const r = calcMonthly({
          month: m,
          employee,
          remunerations: this.remunerations().get(employee.id) ?? [],
          rates: ratesFor(m),
          options: this.options(),
          adjustment: f(m),
          specialInsured: this.special().get(employee.id)?.(m) ?? false,
        });
        for (const g of r.groups) {
          for (const l of g.lines) {
            if (!l.reductionMilli) continue;
            if (l.part === 'pension') pension += refundYen(l.reductionMilli);
            else health += refundYen(l.reductionMilli);
          }
        }
      } catch {
        // その月が計算できない人は数えない（一覧の上の警告で分かる）
      }
    }
    return health + pension > 0 ? { month: m, health, pension } : null;
  });

  /** 表に出す人（その月に加入していない人は隠す） */
  readonly rows = computed(() => this.allRows().filter((r) => r.state !== 'none'));
  readonly hiddenCount = computed(() => this.allRows().length - this.rows().length);

  /** 並べ替え（見出しを押す。月を変えても並びはそのまま） */
  readonly sort = signal<PremiumSort>(DEFAULT_PREMIUM_SORT);
  /** 探す・絞る（従業員の一覧と同じ条件）・ページ。合計は絞り込みに関係なく全員分（11/13） */
  readonly listOptions = signal<PersonListOptions>(defaultListOptions());
  readonly page = signal(1);
  /** 前月から変わった人だけを表に出す（合計は全員分のまま。直してほしい行は隠さない。11/20） */
  readonly onlyChanged = signal(false);
  readonly filteredRows = computed(() => {
    const only = this.onlyChanged();
    return sortPremiumRows(
      filterAndSort(this.rows(), this.listOptions(), (r) => r.employee, () => null, () => false).filter(
        (r) => !only || r.changes.length > 0 || r.state === 'missing' || r.state === 'error',
      ),
      this.sort(),
    );
  });

  toggleOnlyChanged(): void {
    this.onlyChanged.update((v) => !v);
    this.page.set(1);
  }
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

  /**
   * 定時決定がまだ反映されていない人（9月分〜翌年8月分。11/19）
   * 反映するまでは前の標準報酬で計算しているので、一覧の上で知らせて定時決定の画面へつなぐ
   */
  readonly regularPending = computed(() =>
    regularPending(
      this.rows()
        .filter((r) => r.state === 'ok' || r.state === 'exempt')
        .map((r) => ({
          id: r.employee.id,
          health: r.employee.health,
          pension: r.employee.pension,
          // 一斉改定で足した行（capRevised）は定時決定ではないので除く
          remunerations: (this.remunerations().get(r.employee.id) ?? []).filter((x) => !(x as { capRevised?: readonly string[] }).capRevised?.length),
        })),
      this.month(),
      todayLocal(),
    ),
  );

  /** 計算できた人の結果（合計の部品に渡す。11/17） */
  readonly okResults = computed(() => this.rows().flatMap((r) => (r.state === 'ok' && r.result ? [r.result] : [])));

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
   * 納付額は月額と賞与を足してから1円未満を切り捨てる（日本年金機構「保険料の計算方法」1。11/24）。
   * 月額・賞与の行は切り捨てる前の額（銭まで）を出し、合計の行だけを円にする
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
      { ratesFor: ratesForOffice(office, tables), insurerOf: insurerKeyOf(office), options: this.options(), specialInsuredOf: (id) => this.special().get(id) },
      (d) => d.startsWith(month),
    );
    const bonus = officeTotals(c.results);
    const ok = this.rows().flatMap((r) => (r.state === 'ok' && r.result ? [r.result] : []));
    return {
      rows: [
        { key: 'monthly', totals: this.totals() },
        { key: 'bonus', totals: bonus },
        { key: 'sum', totals: officeTotals([...ok, ...c.results]) },
      ],
      problemCount: c.problemCount,
    };
  });

  /** この月に払った賞与の、人ごとの計算（内訳に月額と並べて出す。11/19） */
  readonly bonusByEmployee = computed(() => {
    const tables = this.tables();
    const office = this.context.current();
    const month = this.month();
    const payments = this.bonusPayments();
    if (!tables || !office || !payments.some((p) => p.paidDate.startsWith(month))) return new Map<string, BonusPremiumResult[]>();
    return bonusResultsByEmployee(
      this.employees(),
      payments,
      { ratesFor: ratesForOffice(office, tables), insurerOf: insurerKeyOf(office), options: this.options(), specialInsuredOf: (id) => this.special().get(id) },
      (d) => d.startsWith(month),
    );
  });

  /** その人のこの月の賞与の本人負担（札に出す） */
  bonusEmployeeYen(id: string): number {
    return (this.bonusByEmployee().get(id) ?? []).reduce((s, r) => s + r.employeeYen, 0);
  }

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

  /** 切り捨てる前の額（銭まで。月額・賞与の行。11/24） */
  exactOf(list: OfficeTotal[], category: OfficeTotal['category']): string {
    return formatMilli(list.find((t) => t.category === category)?.totalMilli ?? 0);
  }

  exactSumOf(list: OfficeTotal[]): string {
    return formatMilli(list.reduce((s, t) => s + (t.totalMilli ?? 0), 0));
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
      if (officeId) {
        this.loadNotice(officeId, month);
        this.loadNoticeReview(officeId, month);
      }
    });
    // 告知額の差に合う原因が見つかったら、差の理由の印を先に付けておく（手で選んだあとは触らない。保存は担当者。11/26）
    effect(() => {
      const matched = this.noticeMatched();
      untracked(() => {
        if (this.reasonsTouched || matched.length === 0) return;
        this.noticeReasons.set(new Set(matched.map((k) => NOTICE_CAUSE_REASON[k])));
      });
    });
    // 給与ソフトと比べて差がある人がいたら、この給与の月の精算の記録を読む（精算を含めた控除かを当てるため。11/26）
    effect(() => {
      const officeId = this.context.current()?.id;
      // 結果は額が変わるたびに計算し直すので、「差がある人がいるか」だけで読み直しを決める（11/27）
      if (!officeId || !this.deductionHasDiff()) return;
      const month = this.month();
      const payMonth = this.payMonth();
      untracked(() => void this.loadSettledForPay(officeId, month, payMonth));
    });
    // 月を変えたら、その月の確定と精算の記録を読む（確定1件＋精算の記録）
    effect(() => {
      const officeId = this.context.current()?.id;
      const month = this.month();
      if (officeId) this.loadClose(officeId, month);
    });
    // 月を開いたら、①の表は「前月から変わった人と要確認の人」から見せる（変わった人がいなければ全員。11/26）
    // 月ごとに1回だけ決める（押して全員に戻したあとは、そのまま）
    effect(() => {
      const key = `${this.context.current()?.id ?? ''}|${this.month()}`;
      if (this.loading() || this.rows().length === 0 || this.changedDefaultFor === key) return;
      this.changedDefaultFor = key;
      this.onlyChanged.set(this.changedCount() > 0);
      this.page.set(1);
    });
  }

  /** ①の表の初めの見せ方を決めた月（事業所|月） */
  private changedDefaultFor: string | null = null;

  // ===== 毎月の業務の順の案内（①本人負担 → ②給与ソフトと照合 → ③納付額 → ④告知額。11/26） =====

  /** 今の画面で読んだ控除額のファイルとの照合の結果（この月のものだけ。読んでいなければ null） */
  readonly softCheckNow = computed<SoftCheck | null>(() => {
    const r = this.deductionResult();
    if (!r || r.month !== this.month()) return null;
    return softCheckOf(r.rows, r.fileName, r.checkedAt);
  });

  readonly guideSteps = computed<GuideStep[]>(() =>
    premiumGuideSteps({
      close: this.closeForGuide(),
      fixCount: this.problems().length + (this.regularPending()?.ids.length ?? 0),
      softNow: this.softCheckNow(),
      noticeSaved: !!this.savedNotice(),
      noticeStatus: this.noticeCheck().status,
      noticeHasReason: this.noticeReasons().size > 0,
      noticeReview: this.noticeReviewState(),
      solo: (this.context.current()?.memberUids?.length ?? 0) < 2,
    }),
  );

  /** 確認済みの記録を、案内に出す形に（誰が・いつ。11/26） */
  private readonly closeForGuide = computed(() => {
    const c = this.savedClose();
    if (!c) return null;
    return { softCheck: c.softCheck ?? null, closedByName: c.closedByName ?? null, closedOn: shortDate(c.closedAt) };
  });

  // ===== 告知額のダブルチェック（④の済み・まだを決める。11/26） =====
  /** この月の確認の記録（読み込み中は undefined） */
  readonly noticeReview = signal<Review | null | undefined>(undefined);
  readonly noticeReviewState = computed<NoticeReviewState | null | undefined>(() => {
    const r = this.noticeReview();
    if (r === undefined) return undefined;
    if (r === null) return null;
    return { requestedByName: r.requestedByName ?? null, checkedByName: r.checkedByName ?? null, checkedOn: shortDate(r.checkedAt) };
  });

  private async loadNoticeReview(officeId: string, month: string): Promise<void> {
    this.noticeReview.set(undefined);
    try {
      const r = await this.reviewApi.get(officeId, noticeReviewId(month));
      if (month === this.month()) this.noticeReview.set(r);
    } catch (err) {
      console.error(err);
      if (month === this.month()) this.noticeReview.set(null);
    }
  }

  /** 枠の中で頼んだ・確認した・やり直したら、案内も合わせる */
  onNoticeReview(r: Review | null): void {
    this.noticeReview.set(r);
  }

  /** 案内を押した段へ動く（告知額の段は閉じていれば開く） */
  goStep(key: string): void {
    const el = document.getElementById(`step-${key}`);
    if (!el) return;
    if (el instanceof HTMLDetailsElement) el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ===== 月次確定（「この月はこの額で控除した」記録。11/24） =====
  // 確定した後も編集は止めない。確定時と今の計算の差がある人を「確定後に変更あり」として出す

  /** この月の確定（なければ null）。読み込み中は undefined */
  readonly savedClose = signal<MonthClose | null | undefined>(undefined);
  readonly settlements = signal<Record<string, Settlement>>({});
  readonly closeBusy = signal(false);
  readonly closeError = signal<string | null>(null);
  /** 差額の表を開いているか */
  readonly showCloseDiff = signal(false);
  /** 精算する給与の月（差額の表の上で1つ選び、行の「精算済みにする」で使う） */
  readonly settleMonth = signal<string>('');

  private async loadClose(officeId: string, month: string): Promise<void> {
    this.savedClose.set(undefined);
    this.closeError.set(null);
    this.showCloseDiff.set(false);
    try {
      const c = await this.closeApi.get(officeId, month);
      const s = c ? await this.closeApi.settlements(officeId, month) : {};
      if (month !== this.month()) return; // 読んでいる間に月が変わった
      this.savedClose.set(c);
      this.settlements.set(s);
    } catch (err) {
      console.error(err);
      this.savedClose.set(null);
      this.settlements.set({});
    }
  }

  /** 行 → 確定の材料 */
  private sourcesOf(rows: readonly ListItem[]): CloseSource[] {
    return rows.map((r) => ({
      id: r.employee.id,
      state: r.state,
      employeeYen: r.result?.employeeYen ?? 0,
      premiumTotalMilli: r.premiumTotalMilli,
      contributionMilli: r.contributionMilli,
    }));
  }

  /** 計算できる人だけの「今の額」（計算できない人は差額に出さない：上の警告で分かる） */
  private nowPeopleOf(rows: readonly ListItem[]): ClosePeople {
    return buildPeople(this.sourcesOf(rows).filter((r) => r.state !== 'missing' && r.state !== 'error'));
  }

  /** 確認済みにできるか・押す前に知らせること（条件は month-close.ts の closeCheck。11/27） */
  readonly closeState = computed(() =>
    closeCheck({
      future: this.month() > this.thisMonth,
      blockers: closeBlockers(this.sourcesOf(this.allRows())),
      bonusProblems: this.bonusSummary()?.problemCount ?? 0,
      rowCount: this.rows().length,
      regularPending: this.regularPending()?.ids.length ?? 0,
      soft: this.softCheckNow(),
    }),
  );

  /** 確定できない理由（null なら確定できる） */
  readonly closeBlock = computed<string | null>(() => {
    const b = this.closeState().block;
    return b ? `monthClose.block.${b}` : null;
  });

  /** 押す前に知らせる文（照合の差・定時決定の未反映。照合なしはボタンの横の文で出す） */
  readonly closeNoteTexts = computed<string[]>(() =>
    this.closeState()
      .notes.filter((n) => n !== 'softMissing')
      .map((n) =>
        this.transloco.translate(`monthClose.note.${n}`, {
          count: n === 'softDiff' ? (this.softCheckNow()?.diff ?? 0) : (this.regularPending()?.ids.length ?? 0),
        }),
      ),
  );

  /** 確定時と今の計算の差がある人（社員番号の順） */
  readonly closeDiffs = computed<(CloseDiff & { employee: Employee | null })[]>(() => {
    const c = this.savedClose();
    if (!c) return [];
    const rows = this.allRows();
    const problemIds = new Set(rows.filter((r) => r.state === 'missing' || r.state === 'error').map((r) => r.employee.id));
    const today = todayLocal();
    const retiredIds = new Set(this.employees().filter((e) => e.retireDate && e.retireDate < today).map((e) => e.id));
    const byId = new Map(this.employees().map((e) => [e.id, e]));
    return diffsOf(c.people, this.nowPeopleOf(rows), this.settlements(), { month: this.month(), today, retiredIds })
      .filter((d) => !problemIds.has(d.id))
      .map((d) => ({ ...d, employee: byId.get(d.id) ?? null }))
      .sort((a, b) =>
        (a.employee?.employeeNumber ?? '\uffff').localeCompare(b.employee?.employeeNumber ?? '\uffff', 'ja', { numeric: true }),
      );
  });

  /** 確認済みの記録に残した照合（ファイル名・日時・差があった人。11/27） */
  readonly closeSoftInfo = computed(() => {
    const sc = this.savedClose()?.softCheck;
    if (!sc) return null;
    const byId = new Map(this.employees().map((e) => [e.id, e]));
    const ids = sc.diffIds ?? [];
    const people = ids.map((id) => {
      const e = byId.get(id);
      return { id, no: e?.employeeNumber ?? '—', name: e ? `${e.lastName} ${e.firstName}` : '—' };
    });
    const at = sc.checkedAt ? sc.checkedAt.replace(/^\d{4}-(\d{2})-(\d{2})T/, (_, m, d) => `${Number(m)}/${Number(d)} `) : '';
    // 差の人数のうち、名前を残していない人（上限を超えた人・ファイルにしかいない人）
    return { fileName: sc.fileName ?? '', at, diff: sc.diff, people, more: Math.max(0, sc.diff - ids.length) };
  });

  /** 精算がまだの差額の合計（札と表の上に出す） */
  readonly closeOpen = computed(() => openTotals(this.closeDiffs()));

  /** 確定した日時（表示用 YYYY-MM-DD HH:mm） */
  readonly closedAtText = computed(() => {
    const d = this.savedClose()?.closedAt?.toDate?.();
    if (!d) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  });

  async closeMonth(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || !this.context.isAdmin() || this.closeBusy() || this.closeBlock()) return;
    const people = buildPeople(this.sourcesOf(this.allRows()));
    const t = peopleTotals(people);
    const soft = this.softCheckNow();
    const ok = window.confirm(
      this.transloco.translate('monthClose.confirm', {
        month: this.monthParts(this.month()).m,
        count: t.count,
        employee: this.yen(t.employeeYen),
        soft: soft ? this.transloco.translate('monthClose.softReady', soft) : this.transloco.translate('monthClose.softMissing'),
      }) + this.closeNoteTexts().map((t) => `\n${t}`).join(''),
    );
    if (!ok) return;
    this.closeBusy.set(true);
    this.closeError.set(null);
    try {
      await this.closeApi.close(officeId, this.month(), people, this.softCheckNow());
      await this.loadClose(officeId, this.month());
    } catch (err) {
      console.error(err);
      this.closeError.set(errorKeyOf(err, 'monthClose.error.close'));
    } finally {
      this.closeBusy.set(false);
    }
  }

  async cancelClose(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || !this.context.isAdmin() || this.closeBusy()) return;
    if (!window.confirm(this.transloco.translate('monthClose.cancelConfirm', { month: this.monthParts(this.month()).m }))) return;
    this.closeBusy.set(true);
    this.closeError.set(null);
    try {
      await this.closeApi.cancel(officeId, this.month());
      await this.loadClose(officeId, this.month());
    } catch (err) {
      console.error(err);
      this.closeError.set(errorKeyOf(err, 'monthClose.error.cancel'));
    } finally {
      this.closeBusy.set(false);
    }
  }

  toggleCloseDiff(): void {
    this.showCloseDiff.update((v) => !v);
    // 精算する給与の月の初期値：今月分の保険料を控除する給与の月
    if (!this.settleMonth()) {
      this.settleMonth.set(deductionPayMonth(this.thisMonth, this.payroll(), this.context.current()?.deductionHistory));
    }
  }

  async settle(d: CloseDiff): Promise<void> {
    const officeId = this.context.current()?.id;
    const payMonth = this.settleMonth();
    if (!officeId || !this.context.isAdmin() || this.closeBusy()) return;
    if (!MONTH.test(payMonth)) {
      this.closeError.set('monthClose.error.payMonth');
      return;
    }
    this.closeBusy.set(true);
    this.closeError.set(null);
    try {
      await this.closeApi.settle(officeId, this.month(), settlementOf(d, payMonth), !!d.settlement);
      this.settlements.set(await this.closeApi.settlements(officeId, this.month()));
    } catch (err) {
      console.error(err);
      this.closeError.set(errorKeyOf(err, 'monthClose.error.settle'));
    } finally {
      this.closeBusy.set(false);
    }
  }

  async unsettle(d: CloseDiff): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || !this.context.isAdmin() || this.closeBusy()) return;
    this.closeBusy.set(true);
    try {
      await this.closeApi.unsettle(officeId, this.month(), d.id);
      this.settlements.set(await this.closeApi.settlements(officeId, this.month()));
    } catch (err) {
      console.error(err);
      this.closeError.set(errorKeyOf(err, 'monthClose.error.settle'));
    } finally {
      this.closeBusy.set(false);
    }
  }

  /** 符号つきの円（+1,500 / -1,500 / 0） */
  signedYen(n: number): string {
    return (n > 0 ? '+' : '') + this.yen(n);
  }
  signedMilli(n: number): string {
    return (n > 0 ? '+' : '') + formatMilli(n);
  }

  // ===== 確定した月の差額をまとめて見る（突き合わせの「前月までの精算額」と見比べる。押したときだけ読む） =====

  readonly closeSummary = signal<ReturnType<typeof monthDiffSummary>[] | null>(null);
  readonly closeSummaryBusy = signal(false);

  async loadCloseSummary(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || this.closeSummaryBusy()) return;
    this.closeSummaryBusy.set(true);
    try {
      // 時効の2年＋今月までを見られるように、新しい順に25か月
      const closes = await this.closeApi.latest(officeId, 25);
      const today = todayLocal();
      this.closeSummary.set(
        closes
          .map((c) => monthDiffSummary(c.month, c.people, this.nowPeopleOf(this.rowsFor(c.month)), today))
          .filter((x) => x.count > 0),
      );
    } catch (err) {
      console.error(err);
      this.closeError.set(errorKeyOf(err, 'monthClose.error.load'));
    } finally {
      this.closeSummaryBusy.set(false);
    }
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
  /** 差の理由を手で選んだか（選ぶ前は、アプリが当てた原因に印を付けておく。11/26） */
  private reasonsTouched = false;
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
      this.reasonsTouched = (n?.reasons?.length ?? 0) > 0;
      this.noticeNote.set(n?.note ?? '');
    } catch (err) {
      console.error(err);
      this.savedNotice.set(null);
    }
  }

  /** 比べるアプリの合計：月額 ＋ その月に払った賞与 */
  private readonly appTotals = computed(() => {
    const b = this.bonusSummary();
    const base = b ? b.rows.find((r) => r.key === 'sum')!.totals : this.totals();
    // 保険料調整制度：3か月前の軽減額は、告知額から差し引かれている（11/16）
    const r = this.adjustmentRefund();
    if (!r) return base;
    return base.map((t) =>
      t.category === 'health'
        ? { ...t, totalYen: t.totalYen - r.health }
        : t.category === 'pension'
          ? { ...t, totalYen: t.totalYen - r.pension }
          : t,
    );
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

  readonly noticeCheck = computed(() => checkNotice(this.appTotals(), this.noticeAmounts()));
  readonly dueDate = computed(() => dueDateOf(this.month()));
  /** この月は組合健保か（健保の行は年金事務所の告知額ではなく、組合からの請求額と比べる。11/24） */
  readonly kumiaiMonth = computed(() => {
    const o = this.context.current();
    return !!o && insurerFor(o, this.month())?.healthInsurer.type === 'kumiai';
  });
  noticeLabel(c: NoticeCategory): string {
    return noticeLabelKey(c, this.kumiaiMonth());
  }
  readonly arrival = computed(() => noticeArrivalOf(this.month()));

  setNoticeText(c: NoticeCategory, v: string): void {
    this.noticeText.update((t) => ({ ...t, [c]: v }));
    this.noticeSaved.set(false);
  }

  toggleReason(r: DiffReason): void {
    this.reasonsTouched = true;
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
      this.noticeError.set(errorKeyOf(err, 'premiumNotice.error.save'));
    } finally {
      this.noticeSaving.set(false);
    }
  }

  private async load(officeId: string, office: Office): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const [employees, tables, bonusPayments, gradeTables] = await Promise.all([
        this.employeesApi.list(officeId),
        this.rates.tablesFor(officeId, everKumiai(office)),
        this.bonusApi.list(officeId),
        this.rates.grades(),
      ]);
      // 報酬の履歴は従業員ごとに分かれているので、人数分を並行で読む
      // 等級の上限が上がった月は、届出なしの一斉改定の行を足して計算する（保存はしない。11/16）
      const lists = await Promise.all(employees.map((e) => this.remApi.list(officeId, e.id)));
      this.remunerations.set(new Map(employees.map((e, i) => [e.id, withCapRevisions(lists[i], gradeTables)])));
      // 保険料調整制度を使っているときだけ、契約（短時間労働者かの判定）と加入の基準を読む（ログイン中は覚えている）
      if (office.premiumAdjustment?.since) {
        const [contracts, criteria] = await Promise.all([
          Promise.all(employees.map((e) => this.contractApi.list(officeId, e.id))),
          this.criteriaApi.list(),
        ]);
        this.contracts.set(new Map(employees.map((e, i) => [e.id, contracts[i]])));
        this.criteria.set(criteria);
      }
      // 特定被保険者の制度を採用している組合の期間があるときだけ、扶養家族を読む（11/26）
      this.special.set(await this.specialApi.forEmployees(officeId, office, employees));
      this.employees.set(employees);
      this.tables.set(tables);
      this.bonusPayments.set(bonusPayments);
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'premiumList.error.load'));
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

  /** 絞り込み・探す を使っているか（使っていれば、出力は絞り込んだ人だけ＋小計。11/16） */
  readonly isFiltered = computed(() => {
    const o = this.listOptions();
    return listFilterCount(o) > 0 || o.query.trim() !== '' || this.onlyChanged();
  });

  /** 出力の窓に出す人数（絞り込んでいれば絞り込んだ人、なければ全員） */
  readonly exportCount = computed(() => this.filteredRows().length);

  // ===== 項目を選んで出力（11/24） =====

  private readonly exportDialog = viewChild(ExportDialog);
  /** ②の「控除したファイルを読み込み」のカードで開くファイルの選び窓（11/27） */
  private readonly deductionInput = viewChild<ElementRef<HTMLInputElement>>('deductionInput');

  /** ②の2つの操作（入り口カード。11/27） */
  readonly softItems = computed<EntryChoiceItem[]>(() => [
    { icon: 'upload', titleKey: 'payrollSoft.exportButton', noteKey: 'payrollSoft.exportCardNote', key: 'export' },
    { icon: 'download', titleKey: 'payrollSoft.check', noteKey: 'payrollSoft.checkHint', key: 'read' },
  ]);

  onSoftChoice(key: string): void {
    if (key === 'export') this.exportForSoftware();
    if (key === 'read') this.deductionInput()?.nativeElement.click();
  }
  readonly exportDefaultKeys = PREMIUM_DEFAULT_KEYS;
  /** 出せる項目の目録（月・言語が変わったら作り直す） */
  readonly exportCatalog = computed(() => {
    const office = this.context.current();
    const t = (key: string) => this.transloco.translate(key);
    return premiumExportColumns({
      t,
      deptName: (id) => office?.departments?.find((d) => d.id === id)?.name ?? '',
      note: (r) => (r.state === 'ok' ? '' : r.state === 'exempt' ? t('premium.exempt') : t(this.missingKey(r as ListItem))),
      month: this.month(),
      payMonth: this.payMonth(),
    });
  });
  readonly exportStem = computed(() => {
    const lang = this.transloco.getActiveLang() === 'en' ? 'en' : 'ja';
    return premiumFileName(this.context.current()?.name ?? '', this.month(), todayLocal(), lang).replace(/\.csv$/, '');
  });
  readonly exportScopeText = computed(() =>
    this.transloco.translate(this.isFiltered() ? 'exportDialog.scopeFiltered' : 'exportDialog.scopeAll', { n: this.exportCount() }),
  );

  /** 「出力 ▾」のメニューを閉じてから窓を開く */
  openExport(ev: Event): void {
    (ev.target as HTMLElement).closest('details')?.removeAttribute('open');
    void this.exportDialog()?.open();
  }

  /**
   * 今見ている月の一覧の表（CSV と xlsx で同じ中身。賞与は含まない）
   * 画面の絞り込み・並べ替えのとおり（ページ送りには関係なく、絞り込んだ人全員）。11/16
   * 合計は事業所全体の分を別に書く（絞り込んだ表を納付額と取り違えないように）
   */
  private exportTable(): { name: string; rows: string[][] } | null {
    const office = this.context.current();
    if (!office || !this.context.isAdmin()) return null;
    const t = (key: string) => this.transloco.translate(key);
    const lang = this.transloco.getActiveLang() === 'en' ? 'en' : 'ja';
    const dept = office.departments?.find((d) => d.id === this.listOptions().dept)?.name ?? '';
    const subset = this.isFiltered() ? { note: dept } : null;
    const rows: PremiumCsvRow[] = this.filteredRows().map((r) => ({
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
      rows: buildPremiumCsv(rows, totals, lang, subset),
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
        healthGrade: r.health?.grade ?? null,
        pensionGrade: r.pension?.grade ?? null,
        care: !!r.care,
        healthEmployeeYen: r.healthEmployeeYen,
        pensionEmployeeYen: r.pension ? r.pensionEmployeeYen : null,
        healthParts: {
          health: employeeYenOfPart(r.result, 'health'),
          care: employeeYenOfPart(r.result, 'care'),
          childSupport: employeeYenOfPart(r.result, 'childSupport'),
        },
      })),
      this.month(),
      this.payMonth(),
    );
    const label = this.transloco.translate('payrollSoft.fileLabel');
    downloadCsv(safeFileName(`${label}_${office.name}_${this.month()}.csv`), rows);
  }

  /**
   * この月分から標準報酬が変わる人（標準報酬の履歴に、この月からの行がある人。11/26）
   * 給与ソフトの従業員の等級を、改定のたびに直すための一覧
   */
  readonly standardChanges = computed<StandardChangeRow[]>(() => {
    const month = this.month();
    return this.softwareTargets().flatMap((r) => {
      const rems = this.remunerations().get(r.employee.id) ?? [];
      const rem = rems.find((x) => x.from === month);
      if (!rem) return [];
      const cap = !!(rem as { capRevised?: readonly string[] }).capRevised?.length;
      const reason = cap
        ? this.transloco.translate('premiumList.change.cap')
        : this.transloco.translate(`remuneration.reason.${rem.reason}`);
      return [
        {
          employeeNumber: r.employee.employeeNumber ?? null,
          name: `${r.employee.lastName} ${r.employee.firstName}`,
          reason,
          before: {
            health: r.previous?.health ?? null,
            pension: r.previous?.pension ?? null,
            employeeYen: r.previous?.employeeYen ?? null,
          },
          after: {
            health: r.health,
            pension: r.pension,
            employeeYen: r.state === 'ok' ? r.healthEmployeeYen + r.pensionEmployeeYen : 0,
          },
        },
      ];
    });
  });

  /** 標準報酬が変わる人だけの CSV（0人の月も見出しだけ出す。ボタンは出したり消したりしない） */
  exportStandardChanges(): void {
    const office = this.context.current();
    if (!office || !this.context.isAdmin()) return;
    const rows = standardChangeRows(this.standardChanges(), this.month(), this.payMonth());
    const label = this.transloco.translate('payrollSoft.changeFileLabel');
    downloadCsv(safeFileName(`${label}_${office.name}_${this.month()}.csv`), rows);
  }

  readonly importAccept = IMPORT_ACCEPT;
  readonly deductionSpec = DEDUCTION_TABLE_SPEC;
  /** 読んだ控除額のファイル（列を合わせている間） */
  readonly deductionFile = signal<{ name: string; tables: SheetTable[] } | null>(null);
  /**
   * 列を合わせ終わった控除額のファイル（どの月の一覧と比べるか・ファイル名・照合した日時。11/27）
   * 結果は保存せず、今の本人負担と毎回比べ直す（照合のあとに料率や標準報酬を直しても、結果が追いつく。Q7）
   */
  private readonly deductionTable = signal<{ month: string; fileName: string; checkedAt: string; table: string[][] } | null>(null);
  /** 比べた結果（どの月の一覧と比べたか） */
  readonly deductionResult = computed<{ month: string; fileName: string; checkedAt: string; rows: CompareRow[] } | null>(() => {
    const t = this.deductionTable();
    if (!t || t.month !== this.month()) return null;
    const app: AppDeduction[] = this.softwareTargets().map((r) => ({
      id: r.employee.id,
      employeeNumber: r.employee.employeeNumber ?? null,
      lastName: r.employee.lastName,
      firstName: r.employee.firstName,
      healthEmployeeYen: r.healthEmployeeYen,
      pensionEmployeeYen: r.pensionEmployeeYen,
    }));
    return { month: t.month, fileName: t.fileName, checkedAt: t.checkedAt, rows: compareDeductions(t.table, app) };
  });
  /** 照合で差がある人がいるか（精算の記録を読むかどうか。値が同じなら読み直さない） */
  private readonly deductionHasDiff = computed(() => !!this.deductionResult()?.rows.some((r) => r.status === 'diff'));
  readonly deductionError = signal<string | null>(null);
  readonly showAllDeductions = signal(false);

  async onDeductionFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.deductionTable.set(null);
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
    this.showAllDeductions.set(false);
    this.deductionTable.set({ month: this.month(), fileName: file?.name ?? '', checkedAt: nowMinute(), table });
  }

  cancelDeduction(): void {
    this.deductionFile.set(null);
  }

  closeDeduction(): void {
    this.deductionTable.set(null);
    this.deductionError.set(null);
  }

  /** 表に出す行（初期は差がある人・照合できない人だけ） */
  readonly deductionRows = computed(() => {
    const r = this.deductionResult();
    if (!r) return [];
    return this.showAllDeductions() ? r.rows : r.rows.filter((x) => x.status !== 'match');
  });
  readonly deductionMatchCount = computed(() => this.deductionResult()?.rows.filter((x) => x.status === 'match').length ?? 0);

  // ===== 差の原因を、アプリのデータから当てる（② 給与ソフト・④ 告知額。11/26） =====

  /** この給与の月で精算した差額（従業員ID → 本人分の合計）。差がある人がいるときだけ読む */
  readonly settledForPay = signal<Map<string, number> | null>(null);
  private settledKey: string | null = null;

  private async loadSettledForPay(officeId: string, month: string, payMonth: string): Promise<void> {
    const key = `${officeId}|${month}|${payMonth}`;
    if (this.settledKey === key) return;
    this.settledKey = key;
    this.settledForPay.set(null);
    try {
      // 精算できるのは、確認済みにした前の月だけ（時効の2年まで）
      const closes = await this.closeApi.range(officeId, shiftMonth(month, -24), shiftMonth(month, -1));
      const lists = await Promise.all(closes.map((c) => this.closeApi.settlements(officeId, c.month)));
      const sum = new Map<string, number>();
      for (const list of lists) {
        for (const s of Object.values(list)) {
          if (s.payMonth === payMonth) sum.set(s.employeeId, (sum.get(s.employeeId) ?? 0) + s.diffEmployeeYen);
        }
      }
      if (this.settledKey === key) this.settledForPay.set(sum);
    } catch (err) {
      console.error(err);
      if (this.settledKey === key) this.settledForPay.set(new Map());
    }
  }

  /** 差がある人の、考えられる原因（従業員ID → 原因。合うものがなければ空の配列） */
  readonly deductionCauseMap = computed(() => {
    const res = this.deductionResult();
    const out = new Map<string, FoundCause<DeductionCause>[]>();
    if (!res || res.month !== this.month()) return out;
    const byId = new Map(this.rows().map((r) => [r.employee.id, r]));
    const settled = this.settledForPay() ?? new Map<string, number>();
    for (const d of res.rows) {
      if (d.status !== 'diff' || !d.employee || !d.soft) continue;
      const r = byId.get(d.employee.id);
      if (!r) continue;
      const softYen = d.soft.total ?? (d.soft.health ?? 0) + (d.soft.pension ?? 0);
      out.set(
        d.employee.id,
        deductionCauses(softYen, {
          appYen: r.healthEmployeeYen + r.pensionEmployeeYen,
          previousYen: r.previous?.employeeYen ?? null,
          changes: r.changes,
          lastMonth: r.lastMonth,
          childSupportYen: employeeYenOfPart(r.result, 'childSupport') ?? 0,
          careYen: employeeYenOfPart(r.result, 'care') ?? 0,
          settlementYen: settled.get(d.employee.id) ?? 0,
        }),
      );
    }
    return out;
  });

  /** 原因の一文（画面に出す言葉） */
  deductionCauseText(row: CompareRow): string {
    if (row.status !== 'diff' || !row.employee) return '';
    const causes = this.deductionCauseMap().get(row.employee.id);
    if (!causes) return '';
    if (causes.length === 0) return this.transloco.translate('payrollSoft.cause.unknown');
    return causes
      .map((c) => {
        const p: Record<string, string | number> = { ...(c.params ?? {}) };
        if (typeof p['amount'] === 'number') p['amount'] = this.yen(p['amount'] as number);
        if (typeof p['previous'] === 'number') p['previous'] = this.yen(p['previous'] as number);
        if (typeof p['changes'] === 'string') {
          p['changes'] = (p['changes'] as string)
            .split(',')
            .map((k) => this.transloco.translate(`premiumList.change.${k}`))
            .join('・');
        }
        return this.transloco.translate(`payrollSoft.cause.${c.key}`, p);
      })
      .join(' ／ ');
  }

  /** 告知額の差に合う原因の候補（この月の全員から作る） */
  readonly noticeCandidateList = computed<NoticeCandidate[]>(() => {
    const month = this.month();
    // 前の月で資格を失った人（今月はかからない）も入れるため、表から外した人も含めて見る
    const people: NoticePerson[] = this.allRows().map((r) => {
      const now = r.state === 'ok' ? categoryMilliOf(r.result) : { health: 0, pension: 0, childContribution: 0 };
      const before = r.previous?.categoryMilli ?? { health: 0, pension: 0, childContribution: 0 };
      const had = before.health + before.pension + before.childContribution > 0;
      const has = now.health + now.pension + now.childContribution > 0;
      const rem = (this.remunerations().get(r.employee.id) ?? []).find((x) => x.from === month);
      return {
        name: `${r.employee.lastName} ${r.employee.firstName}`,
        now,
        before,
        joined: r.changes.includes('new'),
        left: had && !has && r.state === 'none',
        regraded: !!rem && rem.reason !== 'acquisition',
        rateChanged: r.changes.includes('rate'),
      };
    });
    const bonus = this.bonusSummary()?.rows.find((x) => x.key === 'bonus')?.totals ?? null;
    const bonusMilli = bonus
      ? {
          health: (bonus.find((t) => t.category === 'health')?.totalYen ?? 0) * 1000,
          pension: (bonus.find((t) => t.category === 'pension')?.totalYen ?? 0) * 1000,
          childContribution: (bonus.find((t) => t.category === 'childContribution')?.totalYen ?? 0) * 1000,
        }
      : null;
    return noticeCandidates(people, bonusMilli);
  });

  /** 告知額の差に合った原因（差がない・入れていないときは空） */
  readonly noticeMatched = computed<NoticeCause[]>(() => {
    const nc = this.noticeCheck();
    if (nc.status !== 'diff') return [];
    const diff = { health: null, pension: null, childContribution: null } as Record<NoticeCategory, number | null>;
    for (const l of nc.lines) diff[l.category] = l.diff;
    return matchNotice(diff, this.noticeCandidateList());
  });

  /** 画面に出す形（原因・人・欄ごとの額） */
  readonly noticeMatchedView = computed(() =>
    this.noticeMatched().map((key) => {
      const c = this.noticeCandidateList().find((x) => x.key === key)!;
      const shown = c.names.slice(0, 3).join('・');
      const more = c.names.length > 3 ? this.transloco.translate('premiumNotice.cause.more', { n: c.names.length - 3 }) : '';
      return { key, names: shown + more, yen: c.yen };
    }),
  );

  nameOf(row: CompareRow): string {
    return row.employee ? `${row.employee.lastName} ${row.employee.firstName}` : row.label;
  }

  // ===== 表示の小道具 =====

  /** 何月に支払う給与から控除するか */
  readonly payMonth = computed(() =>
    deductionPayMonth(this.month(), this.payroll(), this.context.current()?.deductionHistory),
  );
  /** この月分の控除の時期（履歴があればその月の時期。11/20） */
  readonly deductionNow = computed(() =>
    deductionAt(this.month(), this.payroll(), this.context.current()?.deductionHistory),
  );
  /** 控除の時期の切り替えで、控除する給与で2か月分をまとめて引く月か（翌月控除 → 当月控除。11/20） */
  readonly doubleDeduction = computed(
    () => premiumMonthsOfPay(this.payMonth(), this.payroll(), this.context.current()?.deductionHistory).length === 2,
  );

  /** 事業所に給与の支払区分があるか（11/24） */
  readonly hasGroups = computed(() => {
    const o = this.context.current();
    return !!o && hasPayGroups(o);
  });

  /** その人の、この月分を控除する給与の支払月（給与の支払区分で決まる。11/24） */
  payMonthOf(e: Employee): YearMonth {
    const o = this.context.current();
    if (!o) return this.payMonth();
    return deductionPayMonth(this.month(), payrollAt(o, e, this.month()), deductionHistoryAt(o, e, this.month()));
  }

  /** 控除する給与の月が見出しと違う人の札（区分が違う人だけ）。同じなら null */
  otherPayMonth(e: Employee): string | null {
    if (!this.hasGroups()) return null;
    const m = this.payMonthOf(e);
    return m === this.payMonth() ? null : String(Number(m.slice(5)));
  }

  // ===== 保険料の立替（ボタンを押したときだけ、控除する支払月の給与を読む） =====

  /** 確かめた月分と、その人が控除される支払月の給与（従業員ID → 実績） */
  private readonly advanceChecked = signal<{ month: string; payrolls: Map<string, Payroll> } | null>(null);
  readonly advanceBusy = signal(false);
  /** 今見ている月で確かめ済みか（月を変えたら、もう一度押す） */
  readonly advanceReady = computed(() => this.advanceChecked()?.month === this.month());

  /** 立替が要りそうな人（従業員ID → 立て替える額の目安） */
  readonly advances = computed(() => {
    const c = this.advanceChecked();
    const out = new Map<string, number>();
    if (!c || c.month !== this.month()) return out;
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
    if (!c || c.month !== this.month()) return 0;
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
      const month = this.month();
      // 控除する支払月ごとに読む（給与の支払区分で、人により支払月が違うことがある。11/24）
      const byPay = new Map<string, string[]>();
      for (const r of this.rows()) {
        if (r.state !== 'ok') continue;
        const pm = this.payMonthOf(r.employee);
        byPay.set(pm, [...(byPay.get(pm) ?? []), r.employee.id]);
      }
      const maps = await Promise.all([...byPay].map(([pm, ids]) => this.payrollApi.month(officeId, ids, pm)));
      const payrolls = new Map<string, Payroll>();
      for (const m of maps) for (const [id, p] of m) payrolls.set(id, p);
      this.advanceChecked.set({ month, payrolls });
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

/** 記録の日時を「M/D」に（ない・読めないときは null） */
function shortDate(t: { toDate(): Date } | null | undefined): string | null {
  if (!t || typeof t.toDate !== 'function') return null;
  const d = t.toDate();
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 今の日時（照合した日時の記録。ローカルの YYYY-MM-DDTHH:mm。11/27） */
function nowMinute(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
