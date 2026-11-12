import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ContractDoc } from '../../../../core/models/contract';
import { Employee } from '../../../../core/models/employee';
import { CriteriaDoc } from '../../../../core/models/master';
import { TodoDismissalDoc } from '../../../../core/models/office-records';
import { shiftMonth, todayLocal, toYearMonth } from '../../../../shared/utils/date';
import { ContractService } from '../../../employees/contract.service';
import { EmployeeService } from '../../../employees/employee.service';
import { reasonParams } from '../../../employees/logic/classify';
import { CriteriaService } from '../../../office/criteria.service';
import { payrollOf } from '../../../office/office-settings';
import { latestPaidMonth } from '../../../payrolls/logic/payroll-rows';
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
  cardReturnTodo,
  contractEndTodo,
  lumpSumTodo,
  myNumberTodos,
  residenceTodo,
  specificOfficeTodo,
  workPermitTodo,
} from '../../logic/extra-todos';
import { MyNumberEntry } from '../../../../core/models/my-number';
import { MyNumberService } from '../../../my-number/my-number.service';
import { TodoBadgeService } from '../../todo-badge.service';
import { TodoService } from '../../todo.service';

/** よく使うメニューの1つ */
interface MenuTile {
  key: string; // home.menu.〇〇
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
@Component({
  selector: 'app-dashboard',
  imports: [Icon, RouterLink, TranslocoPipe, TodoDialog],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  private readonly context = inject(OfficeContext);
  private readonly employeesApi = inject(EmployeeService);
  private readonly contractsApi = inject(ContractService);
  private readonly criteriaApi = inject(CriteriaService);
  private readonly requestsApi = inject(RequestService);
  private readonly myNumbersApi = inject(MyNumberService);
  private readonly api = inject(TodoService);
  private readonly badge = inject(TodoBadgeService);
  private readonly tasksApi = inject(FilingTaskService);
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

  private readonly byId = computed(() => new Map(this.employees().map((e) => [e.id, e])));

  /** 事業所の設定で、判定の前に要るものが足りない */
  private readonly officeIssues = computed<OfficeIssue[]>(() => {
    const o = this.office();
    const list: OfficeIssue[] = [];
    if (o && !o.standardHours) list.push('noStandard');
    if (this.criteria()?.length === 0) list.push('noCriteria');
    // 事業所整理記号は、適用されると年金機構から付く → 空なら新規適用届がまだかもしれない（事実発生から5日以内）
    if (o && !o.officeSymbol) list.push('newApplication');
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
    const items: BoardItem[] = [
      ...todos.map(todoItem),
      ...extras.map(extraItem),
      ...myNumberTodos(this.employees(), this.myNumberIndex(), this.today).map(extraItem),
      ...(specific ? [extraItem(specific)] : []),
      ...ageItems(this.employees(), this.thisMonth, shiftMonth(this.thisMonth, 1), this.today),
      ...this.officeIssues().map(officeItem),
      ...this.tasks().map(taskItem),
      ...(this.submittedRequests() > 0 ? [requestsItem()] : []),
    ];
    return groupBoard(items, activeDismissals(this.dismissalDocs(), this.today));
  });

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
      { key: 'addEmployee', icon: 'people', link: [...o, 'employees', 'new'] },
      { key: 'import', icon: 'inbox', link: [...o, 'employees', 'import'] },
      { key: 'request', icon: 'todo', link: [...o, 'requests', 'new'] },
      { key: 'bonus', icon: 'bonus', link: [...o, 'bonuses', 'new'] },
    ];
  });

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
    // ヘッダーのベルに件数を渡す（片づけるたびに減る）
    effect(() => {
      const id = this.office()?.id;
      // 確認待ちの依頼はベルで別に数えるので、ここでは除く
      const n = openCount(this.groups().filter((g) => g.kind !== 'requests'));
      if (id && !this.loading()) this.badge.setTodoCount(id, n);
    });
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
    } catch (err) {
      console.error(err);
      this.errorKey.set('dashboard.todo.error');
    } finally {
      this.loading.set(false);
    }
    if (this.context.isAdmin()) {
      // マイナンバーの状態（チェック待ち・廃棄の時期）。1回の読み取りで全員分
      this.myNumbersApi
        .index(officeId)
        .then((m) => this.myNumberIndex.set(m))
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
