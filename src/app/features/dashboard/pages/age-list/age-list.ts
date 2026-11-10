import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { shiftMonth, todayLocal, toYearMonth, YearMonth } from '../../../../shared/utils/date';
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

/** 「以内」の範囲：今月から何か月先まで（0 は今月だけ） */
const WITHIN = [0, 1, 6, 12] as const;
type Within = (typeof WITHIN)[number];
const DEFAULT_WITHIN: Within = 12;

interface AgeRow {
  employee: Employee;
  event: AgeEvent;
}

interface AgeGroup {
  month: YearMonth;
  rows: AgeRow[];
}

/**
 * 年齢到達の一覧（1年先まで探せる）。To-do リストには今月と来月の分だけを出し、ここで先まで見る
 * 11/10 に To-do リストのページから引っ越した（中身は同じ。初期値の範囲だけ「1年以内」に）
 */
@Component({
  selector: 'app-age-list',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './age-list.html',
  styleUrl: './age-list.css',
})
export class AgeList {
  private readonly context = inject(OfficeContext);
  private readonly employeesApi = inject(EmployeeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly office = this.context.current;
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

  constructor() {
    effect(() => {
      const office = this.context.current();
      if (office) void this.load(office.id);
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
