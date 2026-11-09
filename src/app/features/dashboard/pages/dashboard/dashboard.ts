import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { map } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { LanguageService } from '../../../../core/i18n/language.service';
import { PREFECTURES } from '../../../../core/master/prefectures';
import { Employee } from '../../../../core/models/employee';
import { todayLocal, shiftMonth, toYearMonth, YearMonth } from '../../../../shared/utils/date';
import { EmployeeService } from '../../../employees/employee.service';
import {
  AGE_MILESTONES,
  AgeEvent,
  ageEventsIn,
  AgeMilestone,
  AgeSort,
  compareAgeEvents,
  isActive,
  sortMonthOf,
} from '../../../employees/logic/age-events';
import { OfficeContext } from '../../../office/office-context.service';
import { RequestService } from '../../../requests/request.service';
import { ContractDoc } from '../../../../core/models/contract';
import { CriteriaDoc } from '../../../../core/models/master';
import { ContractService } from '../../../employees/contract.service';
import { CriteriaService } from '../../../office/criteria.service';
import { personTodos, sortTodos, Todo } from '../../logic/todos';

interface TodoRow {
  todo: Todo;
  employee: Employee;
}

/** 「以内」の範囲：今月から何か月先まで（0 は今月だけ） */
const WITHIN = [0, 1, 6, 12] as const;
type Within = (typeof WITHIN)[number];
const DEFAULT_WITHIN: Within = 1;

interface AgeRow {
  employee: Employee;
  event: AgeEvent;
}

interface AgeGroup {
  month: YearMonth;
  rows: AgeRow[];
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  private readonly auth = inject(AuthService);
  private readonly context = inject(OfficeContext);
  private readonly language = inject(LanguageService);
  private readonly employeesApi = inject(EmployeeService);
  private readonly contractsApi = inject(ContractService);
  private readonly criteriaApi = inject(CriteriaService);
  private readonly requestsApi = inject(RequestService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly profile = this.auth.profile;
  readonly office = this.context.current;

  readonly prefectureName = computed(() => {
    const p = PREFECTURES.find((x) => x.code === this.office()?.prefecture);
    if (!p) return '';
    return this.language.lang() === 'en' ? p.en : p.ja;
  });

  // ===== 年齢到達 =====
  readonly today = todayLocal();
  readonly thisMonth = toYearMonth(this.today);
  readonly withinOptions = WITHIN;
  readonly allAges = AGE_MILESTONES;

  private readonly employees = signal<Employee[]>([]);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);

  // 表示の状態は URL に持つ（?within=6&ages=40,70&sort=effect）
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  readonly within = computed<Within>(() => {
    const n = Number(this.params().get('within'));
    return (WITHIN as readonly number[]).includes(n) && this.params().has('within')
      ? (n as Within)
      : DEFAULT_WITHIN;
  });

  /** 選んでいる年齢（指定がなければ全部） */
  readonly ages = computed<AgeMilestone[]>(() => {
    const raw = this.params().get('ages');
    if (!raw) return AGE_MILESTONES;
    const picked = AGE_MILESTONES.filter((a) => raw.split(',').includes(String(a)));
    return picked.length > 0 ? picked : AGE_MILESTONES;
  });

  readonly sort = computed<AgeSort>(() =>
    this.params().get('sort') === 'effect' ? 'effect' : 'birthday',
  );

  readonly lastMonth = computed(() => shiftMonth(this.thisMonth, this.within()));

  /** 月ごとにまとめた到達の一覧 */
  readonly groups = computed<AgeGroup[]>(() => {
    const sort = this.sort();
    const rows: AgeRow[] = this.employees()
      .filter((e) => isActive(e, this.today))
      .flatMap((employee) =>
        ageEventsIn(employee, this.thisMonth, this.lastMonth(), this.ages()).map((event) => ({
          employee,
          event,
        })),
      )
      .sort((a, b) => compareAgeEvents(a.event, b.event, sort));

    const groups: AgeGroup[] = [];
    for (const row of rows) {
      const month = sortMonthOf(row.event, sort);
      const last = groups[groups.length - 1];
      if (last && last.month === month) last.rows.push(row);
      else groups.push({ month, rows: [row] });
    }
    return groups;
  });

  readonly count = computed(() => this.groups().reduce((s, g) => s + g.rows.length, 0));

  // ===== やること（区分の判定と加入の状態から） =====
  private readonly contracts = signal<Map<string, ContractDoc[]>>(new Map());
  private readonly criteria = signal<CriteriaDoc[] | null>(null);
  readonly todosLoading = signal(true);
  /** 確認待ちの依頼・申請の数 */
  readonly submittedRequests = signal(0);

  /** 事業所の設定で、判定の前に要るものが足りない */
  readonly officeTodos = computed(() => {
    const o = this.office();
    const list: ('noStandard' | 'noCriteria')[] = [];
    if (o && !o.standardHours) list.push('noStandard');
    if (this.criteria()?.length === 0) list.push('noCriteria');
    return list;
  });

  readonly todos = computed<TodoRow[]>(() => {
    const o = this.office();
    const criteria = this.criteria();
    if (!o || !criteria) return [];
    const office = { standardHours: o.standardHours ?? null, specificApplication: o.specificApplication };
    const byId = new Map(this.employees().map((e) => [e.id, e]));
    const list = this.employees().flatMap((e) =>
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
    return sortTodos(list).map((todo) => ({ todo, employee: byId.get(todo.employeeId)! }));
  });

  /** 定時決定の時期（6〜8月）は、定時決定の画面への入口を出す */
  readonly regularSeason = computed(() => {
    const m = Number(this.thisMonth.slice(5));
    return m >= 6 && m <= 8 ? Number(this.thisMonth.slice(0, 4)) : null;
  });

  employeeName(e: Employee): string {
    return `${e.lastName} ${e.firstName}`.trim();
  }

  constructor() {
    // 事業所が切り替わったら読み直す
    effect(() => {
      const office = this.context.current();
      if (office) this.load(office.id);
    });
  }

  private async load(officeId: string): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      this.employees.set(await this.employeesApi.list(officeId));
    } catch (err) {
      console.error(err);
      this.errorKey.set('dashboard.ages.error');
    } finally {
      this.loading.set(false);
    }
    await this.loadTodos(officeId);
    if (this.context.isAdmin()) {
      this.requestsApi
        .countSubmitted(officeId)
        .then((n) => this.submittedRequests.set(n))
        .catch((err) => console.error(err));
    }
  }

  /** やることの材料：在籍している人の契約と、加入の基準（退職した人の契約は読まない） */
  private async loadTodos(officeId: string): Promise<void> {
    this.todosLoading.set(true);
    try {
      const active = this.employees().filter((e) => !e.retireDate || e.retireDate >= this.today);
      const [criteria, lists] = await Promise.all([
        this.criteriaApi.list(),
        Promise.all(active.map((e) => this.contractsApi.list(officeId, e.id))),
      ]);
      this.criteria.set(criteria);
      this.contracts.set(new Map(active.map((e, i) => [e.id, lists[i]])));
    } catch (err) {
      console.error(err);
      this.errorKey.set('dashboard.todo.error');
    } finally {
      this.todosLoading.set(false);
    }
  }

  // ===== 絞り込み・並べ替え（URL を書き換える） =====

  private setQuery(queryParams: Record<string, string | number | null>): void {
    this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }

  setWithin(n: Within): void {
    this.setQuery({ within: n === DEFAULT_WITHIN ? null : n });
  }

  setSort(s: AgeSort): void {
    this.setQuery({ sort: s === 'birthday' ? null : s });
  }

  /** 年齢の選択を切り替える（全部外すことはできない） */
  toggleAge(age: AgeMilestone): void {
    const cur = this.ages();
    const next = cur.includes(age) ? cur.filter((a) => a !== age) : [...cur, age];
    if (next.length === 0) return;
    const all = next.length === AGE_MILESTONES.length;
    this.setQuery({ ages: all ? null : [...next].sort((a, b) => a - b).join(',') });
  }

  isAgeOn(age: AgeMilestone): boolean {
    return this.ages().includes(age);
  }

  // ===== 表示の小道具 =====

  monthParts(month: YearMonth): { y: string; m: string } {
    return { y: month.slice(0, 4), m: String(Number(month.slice(5))) };
  }

  /** 影響が出る月が誕生日の月と違う（1日生まれなど）ときだけ注記する */
  effectDiffers(ev: AgeEvent): boolean {
    return ev.effectMonth !== toYearMonth(ev.birthday);
  }
}
