import { fixedForChange } from '../../../../core/models/payroll';
import { Component, computed, HostListener, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ContractDoc } from '../../../../core/models/contract';
import type { Office } from '../../../../core/models/office';
import { Employee } from '../../../../core/models/employee';
import { CriteriaDoc } from '../../../../core/models/master';
import { TodoDismissalDoc } from '../../../../core/models/office-records';
import { shiftMonth, todayLocal, toYearMonth } from '../../../../shared/utils/date';
import { ContractService } from '../../../employees/contract.service';
import { contractAt } from '../../../employees/logic/contract-form-model';
import { EmployeeService } from '../../../employees/employee.service';
import { countGaps, registerGaps, registerLarge } from '../../../employees/logic/labor-register';
import type { EmployeePrivate } from '../../../../core/models/employee';
import { classify, reasonParams } from '../../../employees/logic/classify';
import { CriteriaService } from '../../../office/criteria.service';
import { payrollOf, premiumMonthOfPay } from '../../../office/office-settings';
import { latestPaidMonth, periodOf } from '../../../payrolls/logic/payroll-rows';
import { payrollAt } from '../../../office/logic/pay-group';
import { PayrollService } from '../../../payrolls/payroll.service';
import { adjustmentOfficeStatus } from '../../../premiums/logic/adjustment-office';
import { RateService } from '../../../rates/rate.service';
import { IconName, Icon } from '../../../../shared/components/icon/icon';
import { OfficeContext } from '../../../office/office-context.service';
import { RequestService } from '../../../requests/request.service';
import { TodoDialog } from '../../components/todo-dialog/todo-dialog';
import { ActionPerson, actionFor, ActionRequest } from '../../logic/todo-actions';
import {
  activeDismissals,
  ageItems,
  BOARD_ORDER,
  BoardGroup,
  BoardItem,
  BoardKind,
  DISMISSABLE,
  groupBoard,
  extraItem,
  officeItem,
  OfficeIssue,
  openCount,
  requestsItem,
  taskItem,
  todoItem,
} from '../../logic/todo-board';
import { FilingTask } from '../../../../core/models/filing-task';
import { FilingTaskService } from '../../../filings/filing-task.service';
import { daysLeft, filterRows, kindsIn, RowView, TABLE_LIMIT, toRows } from '../../logic/todo-table';
import { personTodos } from '../../logic/todos';
import {
  adjustmentDeadlineTodo,
  insurerChangeTodos,
  cardReturnTodo,
  contractEndTodo,
  retireGuideTodo,
  retentionTodo,
  lumpSumTodo,
  myNumberTodos,
  overseasCertificateTodo,
  overseasPayAbroadTodo,
  RATES_NOTICE_FROM,
  RATES_NOTICE_TO,
  ratesMissingTodo,
  payrollMissingTodo,
  registerGapsTodo,
  bonusNoneTodos,
  bonusReportTodos,
  enrollmentReportTodos,
  actualHoursTodo,
  acquireAmountTodo,
  childcareSpecialTodo,
  dependentReportTodos,
  DependentSpan,
  childStartsOf,
  actualHoursThreshold,
  bonusCumulativeTodos,
  residenceTodo,
  specificOfficeTodo,
  workPermitTodo,
} from '../../logic/extra-todos';
import { MyNumberEntry } from '../../../../core/models/my-number';
import { LanguageService } from '../../../../core/i18n/language.service';
import { countryName } from '../../../employees/logic/foreign-options';
import { MyNumberService } from '../../../my-number/my-number.service';
import { TodoBadgeService } from '../../todo-badge.service';
import { TodoService } from '../../todo.service';
import { DependentService } from '../../../employees/dependent.service';
import { RemunerationService } from '../../../employees/remuneration.service';
import { BonusService } from '../../../premiums/bonus.service';
import type { BonusPayment } from '../../../../core/models/bonus';
import { PersonName } from '../../../../shared/components/person-name/person-name';
import { StepGuide } from '../../../../shared/components/step-guide/step-guide';
import { RevisionCount, RevisionCountService } from '../../../payrolls/revision-count.service';
import { MonthCloseService } from '../../../premiums/month-close.service';
import { PremiumNoticeService } from '../../../premiums/premium-notice.service';
import { ReviewService } from '../../../reviews/review.service';
import { noticeReviewId } from '../../../reviews/logic/review';
import { monthSpine } from '../../logic/month-spine';

/** よく使うメニューの1つ */
interface MenuTile {
  key: string; // home.menu.〇〇
  icon: IconName;
  link: (string | number)[];
  params?: Record<string, string>;
  /** リンクの代わりに窓を開く（取り込みの入口） */
  action?: 'import';
}

/** はじめの3ステップ（11/13） */
interface StartStep {
  key: 'employees' | 'payroll' | 'premiums';
  icon: IconName;
  link: (string | number)[];
  params?: Record<string, string>;
  done: boolean;
}

/** 取り込みの入口で選ぶもの */
/** インポート／エクスポートの窓の1行（11/16 に出力も足した） */
interface ImportChoice {
  key: string;
  icon: IconName;
  link: (string | number)[];
  params?: Record<string, string>;
}

/** 開いている窓（どの To-do から開いたか） */
interface OpenAction {
  request: ActionRequest;
  person: ActionPerson;
  name: string;
}

/**
 * ホーム：よく使うメニュー・To-do の表（1行1件、届出の期限の近い順）・右の箱（依頼・年1回・設定）
 * To-do の材料は「従業員・契約・加入の基準・確認済み・確認待ちの依頼の数」。開くたびに計算し、結果は保存しない
 * 表にする決まり（期限・急ぎ・並べ方）は logic/todo-table.ts（spec あり）
 */
/** 資格取得届に書いた報酬月額（取得日に効いている契約の見込み。届書の一覧と同じ） */
function acquireReported(contracts: ContractDoc[], e: Employee): number | null {
  const d = [e.health, e.pension].filter((x) => x.enrolled && x.acquiredDate).map((x) => x.acquiredDate!).sort()[0];
  const c = d ? contractAt(contracts, d) : null;
  return c ? c.expectedCash + c.expectedInKind : null;
}

@Component({
  selector: 'app-dashboard',
  imports: [PersonName, Icon, RouterLink, TranslocoPipe, TodoDialog, StepGuide],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  private readonly context = inject(OfficeContext);
  private readonly employeesApi = inject(EmployeeService);
  private readonly transloco = inject(TranslocoService);
  private readonly payrollApi = inject(PayrollService);
  private readonly contractsApi = inject(ContractService);
  private readonly criteriaApi = inject(CriteriaService);
  private readonly ratesApi = inject(RateService);
  private readonly requestsApi = inject(RequestService);
  private readonly myNumbersApi = inject(MyNumberService);
  private readonly api = inject(TodoService);
  private readonly badge = inject(TodoBadgeService);
  private readonly tasksApi = inject(FilingTaskService);
  private readonly bonusApi = inject(BonusService);
  private readonly dependentsApi = inject(DependentService);
  private readonly remunerationsApi = inject(RemunerationService);
  private readonly language = inject(LanguageService);
  private readonly router = inject(Router);
  private readonly revisionCountApi = inject(RevisionCountService);
  private readonly closeApi = inject(MonthCloseService);
  private readonly noticeApi = inject(PremiumNoticeService);
  private readonly reviewApi = inject(ReviewService);

  /** 文の差し込みの国コードを、国の名前にする（海外勤務の To-do） */
  withCountry(params: Record<string, string | number>): Record<string, string | number> {
    const c = params['country'];
    return typeof c === 'string' ? { ...params, country: countryName(c, this.language.lang()) } : params;
  }
  /** 届出の宿題（まだのもの。管理者だけ） */
  private readonly tasks = signal<FilingTask[]>([]);

  readonly office = this.context.current;
  readonly isAdmin = this.context.isAdmin;
  readonly today = todayLocal();
  readonly thisMonth = toYearMonth(this.today);
  readonly reasonParams = reasonParams;

  // ===== 材料 =====
  private readonly employees = signal<Employee[]>([]);
  private readonly contracts = signal<Map<string, ContractDoc[]>>(new Map());
  private readonly criteria = signal<CriteriaDoc[] | null>(null);
  private readonly dismissalDocs = signal<TodoDismissalDoc[]>([]);
  /** 確認待ちの依頼・申請の数 */
  readonly submittedRequests = signal(0);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);

  // ===== 画面の中だけの状態（共有する場面がないので URL には持たない） =====
  /** 未対応／確認済み */
  readonly view = signal<RowView>('open');
  /** 種類で絞る */
  readonly kindFilter = signal<BoardKind | 'all'>('all');
  /** 「すべて表示」を押した */
  readonly showAll = signal(false);
  /** 理由の文を開いている行 */
  readonly openRow = signal<string | null>(null);
  readonly open = signal<OpenAction | null>(null);
  readonly busyKey = signal<string | null>(null);

  /** マイナンバーの状態（管理者だけ。読めなければ空のまま） */
  private readonly myNumberIndex = signal<ReadonlyMap<string, MyNumberEntry>>(new Map());
  /** 家族の番号の状態（従業員ID → 家族ID → 状態） */
  private readonly familyIndex = signal<ReadonlyMap<string, ReadonlyMap<string, MyNumberEntry>>>(new Map());

  /** 今の保険者の料率の「何月分から」（2〜4月だけ読む。それ以外の月は null のまま＝読まない） */
  private readonly rateFroms = signal<string[] | null>(null);

  /** 直近2か月の給与の実績（実際の労働時間の To-do に使う。従業員ID → 実績。11/19） */
  private readonly recentPayrolls = signal<ReadonlyMap<string, { paidMonth: string; workMinutes: number | null; fixed: number }[]>>(new Map());

  /** 養育特例の材料：3歳未満の子がいるかもしれない人の、子の養育開始日と厚生年金の標準報酬月額の履歴（11/19） */
  private readonly childcare = signal<ReadonlyMap<string, { starts: string[]; history: { from: string; pension: number }[] }>>(new Map());
  /** 健康保険・厚生年金に入っている人の扶養家族の「扶養になった日・外れた日」（被扶養者届の To-do。11/20） */
  private readonly dependentSpans = signal<ReadonlyMap<string, DependentSpan[]>>(new Map());

  /** 賞与の支給（不支給報告書・累計申出書の To-do に使う。11/19） */
  private readonly bonusPayments = signal<BonusPayment[]>([]);

  private readonly byId = computed(() => new Map(this.employees().map((e) => [e.id, e])));

  /** 事業所の設定で、判定の前に要るものが足りない */
  private readonly officeIssues = computed<OfficeIssue[]>(() => {
    const o = this.office();
    const list: OfficeIssue[] = [];
    if (o && !o.standardHours) list.push('noStandard');
    if (this.criteria()?.length === 0) list.push('noCriteria');
    // 事業所整理記号は、適用されると年金機構から付く → 空なら新規適用届がまだかもしれない（事実発生から5日以内）
    if (o && !o.officeSymbol) list.push('newApplication');
    // 組合の保険者番号（11/26 に足した欄。それより前に登録した組合の事業所は空のまま）
    if (o && o.healthInsurer.type === 'kumiai' && !o.healthInsurer.insurerNumber) list.push('noInsurerNumber');
    return list;
  });

  readonly groups = computed<BoardGroup[]>(() => {
    const o = this.office();
    const criteria = this.criteria();
    if (!o || !criteria) return [];
    const office = { standardHours: o.standardHours ?? null, specificApplication: o.specificApplication };
    const todos = this.employees().flatMap((e) =>
      personTodos(
        {
          ...e,
          optOutDate: e.optOutDate ?? null,
          contracts: this.contracts().get(e.id) ?? [],
          certificate: e.foreign?.certificate ?? null,
        },
        office,
        criteria,
        this.today,
      ),
    );
    // 在留・資格外活動・脱退一時金（外国籍の人）と、特定適用事業所の人数
    const contracts = this.contracts();
    const extras = this.employees().flatMap((e) =>
      [
        residenceTodo(e, this.today),
        workPermitTodo(e, contracts.get(e.id) ?? [], this.today),
        lumpSumTodo(e, this.today),
        contractEndTodo(e, contracts.get(e.id) ?? [], this.today),
        cardReturnTodo(e, o.healthInsurer.type, this.today),
        retireGuideTodo(e, o.healthInsurer.type, this.today),
        // 退職から5年（保存期間）を過ぎた人（11/27）
        retentionTodo(e, this.today),
        overseasCertificateTodo(e, this.today),
        overseasPayAbroadTodo(e, this.today),
        // 所定は基準未満でも、実際の労働時間が2か月続けて基準以上（調査指摘事例集 事例1。11/19）
        actualHoursTodo(
          e,
          actualHoursThreshold(
            classify(
              { birthDate: e.birthDate, optInDate: e.optInDate, optOutDate: e.optOutDate ?? null, contracts: contracts.get(e.id) ?? [], officer: e.org?.officer ?? null },
              office,
              criteria,
              this.today,
            ),
          ),
          this.recentPayrolls().get(e.id) ?? [],
          // 働いた月で数える：その給与の計算期間の終わりの月（月末締め翌月払いなら前の月。11/25）
          (m) => periodOf(m, payrollAt(o, e, m)).end.slice(0, 7),
        ),
        // 資格取得届の報酬月額（契約の見込み）より、入社後の固定的賃金が多い（手当の入れ漏れ。事例2。11/19）
        acquireAmountTodo(e, acquireReported(contracts.get(e.id) ?? [], e), this.recentPayrolls().get(e.id) ?? []),
        // 3歳未満の子を養育していて、厚生年金の標準報酬月額が子の生まれる前より下がった（厚生年金保険法26条。11/19）
        childcareSpecialTodo(e, this.childcare().get(e.id)?.starts ?? [], this.childcare().get(e.id)?.history ?? [], this.today),
      ].filter((t) => t !== null),
    );
    const specific = specificOfficeTodo(
      office,
      this.employees()
        .filter((e) => contracts.has(e.id))
        .map((e) => ({ ...e, contracts: contracts.get(e.id) ?? [] })),
      criteria,
      this.thisMonth,
    );
    const froms = this.rateFroms();
    const ratesMissing = froms ? ratesMissingTodo(o.healthInsurer.type, froms, this.today) : null;
    // 今月払いの給与の未入力（「月ごとの給与」と同じ数え方。対象期間はその人の給与の支払区分で。11/26）
    const saved = this.payrollSaved();
    const pm = this.payMonth();
    const payrollMissing = saved ? payrollMissingTodo(pm, this.employees(), (e) => periodOf(pm, payrollAt(o, e, pm)), saved) : null;
    const adjustment = adjustmentDeadlineTodo(
      adjustmentOfficeStatus(o.specificApplication).deadline,
      !!o.premiumAdjustment?.since,
      this.today,
    );
    const items: BoardItem[] = [
      ...todos.map(todoItem),
      ...extras.map(extraItem),
      ...myNumberTodos(this.employees(), this.myNumberIndex(), this.today, this.familyIndex()).map(extraItem),
      ...(specific ? [extraItem(specific)] : []),
      ...(ratesMissing ? [extraItem(ratesMissing)] : []),
      ...(payrollMissing ? [extraItem(payrollMissing)] : []),
      ...(this.registerTodo() ? [extraItem(this.registerTodo()!)] : []),
      ...(adjustment ? [extraItem(adjustment)] : []),
      ...insurerChangeTodos(o, this.today).map(extraItem),
      ...bonusNoneTodos(o.bonusMonths ?? [], this.bonusPayments(), this.today).map(extraItem),
      ...bonusReportTodos(this.bonusPayments(), this.today).map(extraItem),
      ...this.employees().flatMap((e) => enrollmentReportTodos(e, this.today)).map(extraItem),
      // 被扶養者（異動）届：扶養家族の増減（マイページの申請の宿題が残っている人は、そちらに任せる。11/20）
      ...this.employees()
        .flatMap((e) => dependentReportTodos(e, this.dependentSpans().get(e.id) ?? [], this.today, this.dependentTaskOwners()))
        .map(extraItem),
      ...this.employees()
        .filter((e) => e.priorBonusTotals)
        .flatMap((e) => bonusCumulativeTodos(e, this.bonusPayments(), this.today))
        .map(extraItem),
      ...ageItems(this.employees(), this.thisMonth, shiftMonth(this.thisMonth, 1), this.today),
      ...this.officeIssues().map(officeItem),
      ...this.tasks().map(taskItem),
      ...(this.submittedRequests() > 0 ? [requestsItem()] : []),
    ];
    return groupBoard(items, activeDismissals(this.dismissalDocs(), this.today));
  });

  /** マイページの申請から来た被扶養者届の宿題が残っている人 */
  private readonly dependentTaskOwners = computed(
    () => new Set(this.tasks().flatMap((t) => (t.kind === 'dependentChange' && t.employeeId ? [t.employeeId] : []))),
  );

  readonly total = computed(() => openCount(this.groups()));

  // ===== 表 =====
  readonly rows = computed(() => toRows(this.groups(), this.today));
  readonly filtered = computed(() => filterRows(this.rows(), this.view(), this.kindFilter()));
  readonly shownRows = computed(() => (this.showAll() ? this.filtered() : this.filtered().slice(0, TABLE_LIMIT)));
  readonly hiddenCount = computed(() => this.filtered().length - this.shownRows().length);
  readonly kinds = computed(() => kindsIn(this.rows(), BOARD_ORDER));
  readonly dismissedCount = computed(() => this.rows().filter((r) => r.dismissed).length);
  readonly daysLeft = (deadline: string) => daysLeft(deadline, this.today);

  // ===== よく使うメニュー（一般のユーザーには、見るだけのものだけ） =====
  readonly payMonth = computed(() => {
    const o = this.office();
    return o ? latestPaidMonth(this.today, payrollOf(o)) : this.thisMonth;
  });
  readonly menu = computed<MenuTile[]>(() => {
    const id = this.office()?.id ?? '';
    const o = ['/o', id];
    if (!this.isAdmin()) {
      return [
        { key: 'premiums', icon: 'premium', link: [...o, 'premiums'] },
        { key: 'employees', icon: 'people', link: [...o, 'employees'] },
        { key: 'payrollsView', icon: 'payroll', link: [...o, 'payrolls'] },
      ];
    }
    return [
      { key: 'payroll', icon: 'payroll', link: [...o, 'payrolls', this.payMonth()] },
      { key: 'premiums', icon: 'premium', link: [...o, 'premiums'] },
      // 従業員・依頼・賞与は、サイドバーと同じく一覧を開く（登録は一覧の入り口カードから。11/27）
      { key: 'addEmployee', icon: 'people', link: [...o, 'employees'] },
      { key: 'import', icon: 'folder', link: [], action: 'import' },
      { key: 'request', icon: 'request', link: [...o, 'requests'] },
      { key: 'bonus', icon: 'bonus', link: [...o, 'bonuses'] },
    ];
  });

  // ===== 今月の処理（手続き → 給与 → 改定 → 保険料の確認。人数はそれぞれの画面と同じ数え方。11/26） =====

  /** 今月払いの給与から控除する保険料の月 */
  readonly spinePremiumMonth = computed(() => {
    const o = this.office();
    return o ? premiumMonthOfPay(this.payMonth(), payrollOf(o), o.deductionHistory) : this.thisMonth;
  });
  readonly revisionCount = signal<RevisionCount | null | 'error'>(null);
  readonly spinePremium = signal<{ closed: boolean; noticeSaved: boolean; reviewed: boolean; solo: boolean } | null>(null);
  /** 改定の候補の人（改定の候補の画面と同じ数え方。押すとその画面へ） */
  readonly spineSteps = computed(() => {
    const o = this.office();
    const r = this.revisionCount();
    const todo = this.loading()
      ? null
      : this.groups()
          .filter((g) => (g.section === 'now' || g.section === 'soon') && g.kind !== 'payrollMissing')
          .reduce((n, g) => n + g.items.length, 0);
    const saved = this.payrollSaved();
    const pm = this.payMonth();
    const missing =
      !o || !saved
        ? null
        : (payrollMissingTodo(pm, this.employees(), (e) => periodOf(pm, payrollAt(o, e, pm)), saved)?.params?.['count'] as number | undefined) ?? 0;
    return monthSpine({
      todo,
      payrollMissing: missing,
      revision: r === null || r === 'error' ? r : { candidates: r.candidates.length, waiting: r.waiting.length },
      premium: this.spinePremium(),
      premiumMonth: Number(this.spinePremiumMonth().slice(5)),
      payMonth: Number(pm.slice(5)),
    });
  });

  /** 今月の処理を出すか（管理者で、従業員がいて、はじめの3ステップを出していないとき） */
  readonly showSpine = computed(() => this.isAdmin() && this.employees().length > 0 && !this.showSteps());

  /** 段を押したら、その画面へ（手続きはこのページの To-do へ） */
  goSpine(key: string): void {
    const id = this.office()?.id;
    if (!id) return;
    if (key === 'todo') {
      document.getElementById('todo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (key === 'payroll') void this.router.navigate(['/o', id, 'payrolls', this.payMonth()]);
    if (key === 'revision') void this.router.navigate(['/o', id, 'revisions']);
    if (key === 'premium') void this.router.navigate(['/o', id, 'premiums'], { queryParams: { month: this.spinePremiumMonth() } });
  }

  private async loadSpine(office: Office): Promise<void> {
    this.revisionCount.set(null);
    this.spinePremium.set(null);
    const month = premiumMonthOfPay(latestPaidMonth(this.today, payrollOf(office)), payrollOf(office), office.deductionHistory);
    // 保険料の確認：確認済み・告知額・別の人の確認（各1件）
    void (async () => {
      try {
        const [close, notice, review] = await Promise.all([
          this.closeApi.get(office.id, month),
          this.noticeApi.get(office.id, month),
          this.reviewApi.get(office.id, noticeReviewId(month)),
        ]);
        if (this.office()?.id !== office.id) return;
        this.spinePremium.set({
          closed: !!close,
          noticeSaved: !!notice,
          reviewed: !!review?.checkedByName,
          solo: (office.memberUids?.length ?? 0) < 2,
        });
      } catch (err) {
        console.error(err);
      }
    })();
    // 改定の候補：画面と同じ材料で数える（読み込みが多いので、ほかの段のあとに出る）
    try {
      const r = await this.revisionCountApi.count(office);
      if (this.office()?.id === office.id) this.revisionCount.set(r);
    } catch (err) {
      console.error(err);
      if (this.office()?.id === office.id) this.revisionCount.set('error');
    }
  }

  // ===== はじめの3ステップ（従業員 → 給与 → 保険料。済んだら消える。11/13） =====

  /** 最新の支払月に給与の実績が入っている人数（月の索引を1件読む。null ＝ まだ） */
  readonly payrollCount = signal<number | null>(null);
  /** 今月払いの給与を入力済みの人（To-do の「未入力」を数える。11/26） */
  private readonly payrollSaved = signal<ReadonlySet<string> | null>(null);
  /** 「閉じる」を押した（事業所ごとにこのブラウザに覚える） */
  readonly stepsClosed = signal(false);

  readonly startSteps = computed<StartStep[]>(() => {
    const o = ['/o', this.office()?.id ?? ''];
    return [
      { key: 'employees', icon: 'people', link: [...o, 'import'], params: { kind: 'employees', from: 'home' }, done: this.employees().length > 0 },
      { key: 'payroll', icon: 'payroll', link: [...o, 'import'], params: { kind: 'payrolls', from: 'home' }, done: (this.payrollCount() ?? 0) > 0 },
      { key: 'premiums', icon: 'premium', link: [...o, 'premiums'], done: false },
    ];
  });

  /** 従業員か今月の給与がまだのときだけ出す */
  readonly showSteps = computed(
    () =>
      this.isAdmin() &&
      !this.loading() &&
      !this.stepsClosed() &&
      this.payrollCount() !== null &&
      (this.employees().length === 0 || this.payrollCount() === 0),
  );

  private stepsKey(): string {
    return `shaho.startSteps.closed.${this.office()?.id ?? ''}`;
  }

  closeSteps(): void {
    this.stepsClosed.set(true);
    try {
      localStorage.setItem(this.stepsKey(), '1');
    } catch {
      // 保存できなくても、この画面では閉じる
    }
  }

  // ===== インポート／エクスポート（11/17）：タイルでプルダウン。取り込みはページ、出力は窓 =====
  private readonly importDialog = viewChild<ElementRef<HTMLDialogElement>>('importDialog');
  readonly ioOpen = signal(false);

  /** 出力する（エクスポート）。それぞれの画面の「出力」へ案内する（11/16） */
  readonly exportChoices = computed<ImportChoice[]>(() => {
    const o = ['/o', this.office()?.id ?? ''];
    return [
      { key: 'employees', icon: 'people', link: [...o, 'employees'] },
      { key: 'premiums', icon: 'premium', link: [...o, 'premiums'] },
      { key: 'payrolls', icon: 'payroll', link: [...o, 'import'], params: { kind: 'payrolls', from: 'home' } },
      { key: 'filings', icon: 'filing', link: [...o, 'filings'] },
      { key: 'myNumbers', icon: 'admin', link: [...o, 'import'], params: { kind: 'myNumber', from: 'home' } },
    ];
  });

  openExport(): void {
    this.ioOpen.set(false);
    this.importDialog()?.nativeElement.showModal();
  }

  /** プルダウンの外を押したら閉じる */
  @HostListener('document:click', ['$event'])
  onDocClick(event: MouseEvent): void {
    if (this.ioOpen() && !(event.target as HTMLElement).closest('.tile-wrap')) this.ioOpen.set(false);
  }

  closeImport(): void {
    this.importDialog()?.nativeElement.close();
  }

  /** 背景（窓の外側）を押したら閉じる */
  onImportBackdrop(event: MouseEvent): void {
    if (event.target === this.importDialog()?.nativeElement) this.closeImport();
  }

  setView(v: string): void {
    this.view.set(v === 'dismissed' ? 'dismissed' : 'open');
    this.showAll.set(false);
  }

  setKind(k: string): void {
    this.kindFilter.set(k === 'all' ? 'all' : (k as BoardKind));
    this.showAll.set(false);
  }

  toggleRow(key: string): void {
    this.openRow.update((k) => (k === key ? null : key));
  }

  monthParts(ym: string): { y: string; m: number } {
    return { y: ym.slice(0, 4), m: Number(ym.slice(5)) };
  }

  constructor() {
    // 事業所が切り替わったら読み直す
    effect(() => {
      const office = this.context.current();
      if (office) void this.load(office.id);
    });
    // 今月の処理（管理者だけ。改定の候補は読み込みが多いので、ほかと分けて読む。11/26）
    effect(() => {
      const office = this.context.current();
      if (office && this.isAdmin()) untracked(() => void this.loadSpine(office));
    });
    // はじめの3ステップ：最新の支払月に給与が入っているか（管理者だけ。月の索引を1件読む）
    effect(() => {
      const office = this.office();
      const month = this.payMonth();
      if (!office || !this.isAdmin()) return;
      untracked(() => {
        try {
          this.stepsClosed.set(localStorage.getItem(this.stepsKey()) === '1');
        } catch {
          this.stepsClosed.set(false);
        }
        this.payrollApi
          .savedIdsByMonth(office.id, [month], true)
          .then((m) => {
            this.payrollCount.set(m.get(month)?.size ?? 0);
            this.payrollSaved.set(m.get(month) ?? new Set());
          })
          .catch((err) => {
            console.error(err);
            this.payrollCount.set(null);
            this.payrollSaved.set(null);
          });
      });
    });
    // ヘッダーのベルに件数を渡す（片づけるたびに減る）
    effect(() => {
      const id = this.office()?.id;
      // 確認待ちの依頼はベルで別に数えるので、ここでは除く
      const n = openCount(this.groups().filter((g) => g.kind !== 'requests'));
      if (id && !this.loading()) this.badge.setTodoCount(id, n);
    });
  }

  /**
   * 来年度の料率があるか（2〜4月だけ読む。読めなくても To-do は出せるので、失敗は記録だけ）
   * 協会けんぽは料率マスタ（ログイン中は覚えている）、組合健保は事業所の料率
   */
  private async loadRateFroms(officeId: string): Promise<void> {
    this.rateFroms.set(null); // 事業所を切り替えたときに、前の事業所の分を残さない
    const month = Number(this.today.slice(5, 7));
    const o = this.office();
    if (!o || o.id !== officeId || month < RATES_NOTICE_FROM || month > RATES_NOTICE_TO) return;
    try {
      const froms =
        o.healthInsurer.type === 'kumiai'
          ? (await this.ratesApi.kumiaiList(officeId)).map((r) => r.from)
          : (await this.ratesApi.master()).filter((r) => r.kind === 'kyokaiHealth').map((r) => r.from);
      this.rateFroms.set(froms);
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * 養育特例の材料を読む（画面の表示は待たない）
   * 厚生年金に入っている人の扶養家族を読み、休業の記録と合わせて「5年以内に養育を始めた子」がいる人だけ、
   * 標準報酬月額の履歴を読む（特例は子が3歳まで＋さかのぼり2年）
   */
  private async loadChildcare(officeId: string, active: readonly Employee[]): Promise<void> {
    try {
      // 扶養家族は、健康保険か厚生年金に入っている人の分を読む（被扶養者届の To-do にも使う。11/20）
      const insured = active.filter((e) => e.health.enrolled || e.pension.enrolled);
      const all = await Promise.all(insured.map((e) => this.dependentsApi.list(officeId, e.id).catch(() => [])));
      this.dependentSpans.set(new Map(insured.map((e, i) => [e.id, all[i].map((x) => ({ from: x.from, to: x.to ?? null }))])));
      const byId = new Map(insured.map((e, i) => [e.id, all[i]]));
      const enrolled = active.filter((e) => e.pension.enrolled);
      const deps = enrolled.map((e) => byId.get(e.id) ?? []);
      const since = shiftMonth(this.thisMonth, -60);
      const targets = enrolled
        .map((e, i) => ({ e, starts: childStartsOf(e.leaves ?? [], deps[i]).filter((d) => d.slice(0, 7) >= since) }))
        .filter((x) => x.starts.length > 0);
      const histories = await Promise.all(targets.map((x) => this.remunerationsApi.list(officeId, x.e.id)));
      this.childcare.set(
        new Map(targets.map((x, i) => [x.e.id, { starts: x.starts, history: histories[i].map((r) => ({ from: r.from, pension: r.pension.standard })) }])),
      );
    } catch (err) {
      console.error(err);
    }
  }

  // ===== 労働者名簿の記入漏れ（管理者だけ。全員の鍵付きの文書を読む。ログインの間は覚えている。11/24） =====
  private readonly privates = signal<Map<string, EmployeePrivate> | null>(null);
  private readonly registerTodo = computed(() => {
    const privates = this.privates();
    if (!privates) return null;
    const list = this.employees();
    const large = registerLarge(list, this.today);
    return registerGapsTodo(
      countGaps(list.map((e) => { const p = privates.get(e.id); return p ? registerGaps({ ...e, ...p }, this.today, large) : []; })),
    );
  });

  /** 何の漏れが何人か → 「（履歴 12・住所 12）」 */
  registerGapText(params: Record<string, string | number>): string {
    const parts = Object.entries(params)
      .filter(([k]) => k !== 'n')
      .map(([k, n]) => `${this.transloco.translate('employee.register.gapShort.' + k)} ${n}`);
    return parts.length ? `（${parts.join('・')}）` : '';
  }

  /** 材料をまとめて読む（契約は在籍している人の分だけ） */
  private async load(officeId: string): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const employees = await this.employeesApi.list(officeId);
      const active = employees.filter((e) => !e.retireDate || e.retireDate >= this.today);
      const [criteria, lists, dismissals] = await Promise.all([
        this.criteriaApi.list(),
        Promise.all(active.map((e) => this.contractsApi.list(officeId, e.id))),
        this.api.listDismissals(officeId),
      ]);
      this.employees.set(employees);
      this.criteria.set(criteria);
      this.contracts.set(new Map(active.map((e, i) => [e.id, lists[i]])));
      this.dismissalDocs.set(dismissals);
      void this.loadRateFroms(officeId);
      this.bonusPayments.set([]);
      this.recentPayrolls.set(new Map());
      this.childcare.set(new Map());
      this.dependentSpans.set(new Map());
      void this.loadChildcare(officeId, active);
      // 直近2か月の給与の実績（実労働時間を入れた人だけが To-do の対象。1回の問い合わせ）
      const latest = this.payMonth();
      this.payrollApi
        .listOfOfficeMonths(officeId, active.map((e) => e.id), [shiftMonth(latest, -1), latest])
        .then((list) => {
          const map = new Map<string, { paidMonth: string; workMinutes: number | null; fixed: number }[]>();
          for (const p of list) map.set(p.employeeId, [...(map.get(p.employeeId) ?? []), { paidMonth: p.paidMonth, workMinutes: p.workMinutes, fixed: fixedForChange(p) }]);
          this.recentPayrolls.set(map);
        })
        .catch((err) => console.error(err));
      this.bonusApi
        .list(officeId)
        .then((list) => this.bonusPayments.set(list))
        .catch((err) => console.error(err));
    } catch (err) {
      console.error(err);
      this.errorKey.set('dashboard.todo.error');
    } finally {
      this.loading.set(false);
    }
    if (this.context.isAdmin()) {
      this.privates.set(null);
      this.employeesApi
        .listPrivates(officeId)
        .then((m) => this.privates.set(m))
        .catch((err) => console.error(err));
      // マイナンバーの状態（チェック待ち・廃棄の時期）。1回の読み取りで全員分
      this.myNumbersApi
        .indexAll(officeId)
        .then((m) => {
          this.myNumberIndex.set(m.people);
          this.familyIndex.set(m.family);
        })
        .catch((err) => console.error(err));
      this.tasksApi
        .listOpen(officeId)
        .then((list) => this.tasks.set(list))
        .catch((err) => console.error(err));
      this.requestsApi
        .countSubmitted(officeId)
        .then((n) => {
          this.submittedRequests.set(n);
          this.badge.requestCount.set(n);
        })
        .catch((err) => console.error(err));
    }
  }

  // ===== その場で片づける =====

  employeeOf(it: BoardItem): Employee | null {
    return it.employeeId ? (this.byId().get(it.employeeId) ?? null) : null;
  }

  private personOf(e: Employee): ActionPerson {
    return {
      id: e.id,
      birthDate: e.birthDate,
      hireDate: e.hireDate,
      retireDate: e.retireDate,
      health: e.health,
      pension: e.pension,
      certificate: e.foreign?.certificate ?? null,
      optOutDate: e.optOutDate ?? null,
    };
  }

  /** その To-do の窓（窓がない種類・管理者でない人は null） */
  requestOf(it: BoardItem): ActionRequest | null {
    const e = this.employeeOf(it);
    if (!e || !this.isAdmin()) return null;
    return actionFor(it, this.personOf(e), this.contracts().get(e.id) ?? [], this.today);
  }

  canDismiss(it: BoardItem): boolean {
    return this.isAdmin() && DISMISSABLE.has(it.kind);
  }

  openAction(it: BoardItem): void {
    const e = this.employeeOf(it);
    const request = this.requestOf(it);
    if (e && request) this.open.set({ request, person: this.personOf(e), name: this.employeeName(e) });
  }

  /** 窓で保存したら、その人だけ読み直す（ほかの人の契約までは読み直さない） */
  async afterSave(): Promise<void> {
    const officeId = this.office()?.id;
    const id = this.open()?.request.employeeId;
    if (!officeId || !id) return;
    try {
      const [e, dismissals] = await Promise.all([
        this.employeesApi.get(officeId, id),
        this.api.listDismissals(officeId),
      ]);
      if (e) this.employees.update((list) => list.map((x) => (x.id === id ? e : x)));
      this.dismissalDocs.set(dismissals);
    } catch (err) {
      console.error(err);
    }
  }

  /** 届出の宿題：「届を出した」「確認した」→ done にして表から外す */
  async completeTask(it: BoardItem): Promise<void> {
    const officeId = this.office()?.id;
    const task = it.task;
    if (!officeId || !task || this.busyKey()) return;
    this.busyKey.set(it.key);
    try {
      await this.tasksApi.markDone(officeId, task.id);
      this.tasks.update((list) => list.filter((t) => t.id !== task.id));
    } catch (err) {
      console.error(err);
      this.errorKey.set('dashboard.todo.errorDismiss');
    } finally {
      this.busyKey.set(null);
    }
  }

  async dismiss(it: BoardItem): Promise<void> {
    await this.runOnDismissals(it, (officeId) => this.api.dismiss(officeId, it.key));
  }

  // ===== 同じ日の届をまとめた行（11/20） =====

  /** 名簿でチェックを外した人（行ごとの鍵ではなく、1人ずつの鍵。初めは全員にチェック） */
  readonly unchecked = signal<ReadonlySet<string>>(new Set());

  isChecked(m: BoardItem): boolean {
    return !this.unchecked().has(m.key);
  }

  toggleMember(m: BoardItem): void {
    this.unchecked.update((set) => {
      const next = new Set(set);
      if (next.has(m.key)) next.delete(m.key);
      else next.add(m.key);
      return next;
    });
  }

  checkedMembers(it: BoardItem): BoardItem[] {
    return (it.members ?? []).filter((m) => this.isChecked(m));
  }

  /** 名簿で選んだ人を、まとめて「確認した」にする */
  async dismissMembers(it: BoardItem): Promise<void> {
    const keys = this.checkedMembers(it).map((m) => m.key);
    if (keys.length === 0) return;
    await this.runOnDismissals(it, (officeId) => this.api.dismissMany(officeId, keys));
  }

  /** その日に扶養に入っている家族の人数（資格取得届の名簿に「扶養 ◯人」と出す。一緒に被扶養者届を出す人が分かる） */
  dependentsOn(employeeId: string | null, date: string | null): number {
    if (!employeeId || !date) return 0;
    return (this.dependentSpans().get(employeeId) ?? []).filter((x) => x.from <= date && (!x.to || x.to > date)).length;
  }

  async undismiss(it: BoardItem): Promise<void> {
    await this.runOnDismissals(it, (officeId) => this.api.undismiss(officeId, it.key));
  }

  private async runOnDismissals(it: BoardItem, write: (officeId: string) => Promise<void>): Promise<void> {
    const officeId = this.office()?.id;
    if (!officeId || this.busyKey()) return;
    this.busyKey.set(it.key);
    try {
      await write(officeId);
      this.dismissalDocs.set(await this.api.listDismissals(officeId));
    } catch (err) {
      console.error(err);
      this.errorKey.set('dashboard.todo.errorDismiss');
    } finally {
      this.busyKey.set(null);
    }
  }

  // ===== 表示の小道具 =====

  employeeName(e: Employee): string {
    return `${e.lastName} ${e.firstName}`.trim();
  }

  /** 定時決定の時期（6〜8月）は、定時決定の画面への入口を出す */
  readonly regularSeason = computed(() => {
    const m = Number(this.thisMonth.slice(5));
    return m >= 6 && m <= 8 ? Number(this.thisMonth.slice(0, 4)) : null;
  });
}
