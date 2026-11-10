import { Component, computed, effect, inject, signal, WritableSignal } from '@angular/core';
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
import { OfficeContext } from '../../../office/office-context.service';
import { RequestService } from '../../../requests/request.service';
import { TodoDialog } from '../../components/todo-dialog/todo-dialog';
import { ActionPerson, actionFor, ActionRequest } from '../../logic/todo-actions';
import {
  activeDismissals,
  ageItems,
  BoardGroup,
  BoardItem,
  BoardKind,
  DISMISSABLE,
  groupBoard,
  officeItem,
  OfficeIssue,
  openCount,
  requestsItem,
  todoItem,
  visibleOf,
} from '../../logic/todo-board';
import { personTodos } from '../../logic/todos';
import { TodoService } from '../../todo.service';

/** 開いている窓（どの To-do から開いたか） */
interface OpenAction {
  request: ActionRequest;
  person: ActionPerson;
  name: string;
}

/**
 * To-do リスト（受信箱）：手続きが要りそうなことを種類ごとに出し、その場で片づける
 * 材料は「従業員・契約・加入の基準・確認済み・確認待ちの依頼の数」。開くたびに計算し、結果は保存しない
 */
@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, TranslocoPipe, TodoDialog],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  private readonly context = inject(OfficeContext);
  private readonly employeesApi = inject(EmployeeService);
  private readonly contractsApi = inject(ContractService);
  private readonly criteriaApi = inject(CriteriaService);
  private readonly requestsApi = inject(RequestService);
  private readonly api = inject(TodoService);

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
  /** 「あと○件を表示」で開いたまとまり */
  readonly expanded = signal<ReadonlySet<BoardKind>>(new Set());
  /** 「確認済みを表示」で開いたまとまり */
  readonly showDismissed = signal<ReadonlySet<BoardKind>>(new Set());
  readonly open = signal<OpenAction | null>(null);
  readonly busyKey = signal<string | null>(null);

  private readonly byId = computed(() => new Map(this.employees().map((e) => [e.id, e])));

  /** 事業所の設定で、判定の前に要るものが足りない */
  private readonly officeIssues = computed<OfficeIssue[]>(() => {
    const o = this.office();
    const list: OfficeIssue[] = [];
    if (o && !o.standardHours) list.push('noStandard');
    if (this.criteria()?.length === 0) list.push('noCriteria');
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
    const items: BoardItem[] = [
      ...todos.map(todoItem),
      ...ageItems(this.employees(), this.thisMonth, shiftMonth(this.thisMonth, 1), this.today),
      ...this.officeIssues().map(officeItem),
      ...(this.submittedRequests() > 0 ? [requestsItem()] : []),
    ];
    return groupBoard(items, activeDismissals(this.dismissalDocs(), this.today));
  });

  readonly total = computed(() => openCount(this.groups()));

  constructor() {
    // 事業所が切り替わったら読み直す
    effect(() => {
      const office = this.context.current();
      if (office) void this.load(office.id);
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
      this.requestsApi
        .countSubmitted(officeId)
        .then((n) => this.submittedRequests.set(n))
        .catch((err) => console.error(err));
    }
  }

  // ===== まとまりの開け閉め =====

  visible(g: BoardGroup) {
    return visibleOf(g, this.expanded().has(g.kind));
  }

  private toggleIn(set: WritableSignal<ReadonlySet<BoardKind>>, kind: BoardKind): void {
    set.update((s) => {
      const next = new Set(s);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  toggleExpanded(kind: BoardKind): void {
    this.toggleIn(this.expanded, kind);
  }

  toggleDismissed(kind: BoardKind): void {
    this.toggleIn(this.showDismissed, kind);
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

  /** まとまりの見出しの前に、区切り（今すぐ／期限が近い／材料不足）を出すか */
  sectionStarts(i: number): boolean {
    const g = this.groups();
    return i === 0 || g[i - 1].section !== g[i].section;
  }
}
