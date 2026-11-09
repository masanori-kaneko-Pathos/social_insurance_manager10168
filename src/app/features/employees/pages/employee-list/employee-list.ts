import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ContractDoc } from '../../../../core/models/contract';
import { Employee } from '../../../../core/models/employee';
import { CriteriaDoc } from '../../../../core/models/master';
import { ageAt, todayLocal, toYearMonth } from '../../../../shared/utils/date';
import { CriteriaService } from '../../../office/criteria.service';
import { OfficeContext } from '../../../office/office-context.service';
import { ContractService } from '../../contract.service';
import { EmployeeService } from '../../employee.service';
import { Category, classify, Classification } from '../../logic/classify';
import {
  COVERAGE_FILTERS,
  CoverageFilter,
  matchesCoverage,
  SORT_KEYS,
  SortDir,
  SortKey,
  sortEmployees,
} from '../../logic/employee-sort';
import { groupByName, matchesName, NameSection, RomanBy } from '../../logic/name-index';

import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
type StatusFilter = 'active' | 'retired' | 'all';
const STATUSES: readonly StatusFilter[] = ['active', 'retired', 'all'];

/** 区分の絞り込み（all は絞らない） */
export const CATEGORY_FILTERS = ['all', 'regular', 'shortTime', 'reducedWage', 'excluded', 'unknown'] as const;
type CategoryFilter = (typeof CATEGORY_FILTERS)[number];

const pick = <T extends string>(list: readonly T[], v: string | null, fallback: T): T =>
  v && (list as readonly string[]).includes(v) ? (v as T) : fallback;

@Component({
  selector: 'app-employee-list',
  imports: [HalfWidthDigits, RouterLink, TranslocoPipe],
  templateUrl: './employee-list.html',
  styleUrl: './employee-list.css',
})
export class EmployeeList {
  private readonly employeesApi = inject(EmployeeService);
  private readonly contractsApi = inject(ContractService);
  private readonly criteriaApi = inject(CriteriaService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly context = inject(OfficeContext);

  readonly today = todayLocal();
  readonly thisMonth = toYearMonth(this.today);
  readonly employees = signal<Employee[]>([]);
  readonly loading = signal(true);

  readonly statuses = STATUSES;
  readonly coverageFilters = COVERAGE_FILTERS;
  readonly categoryFilters = CATEGORY_FILTERS;
  readonly sortKeys = SORT_KEYS;

  // ===== 表示の状態は URL に持つ（?q=&status=&sort=&dir=&cov=&cat=） =====
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly query = computed(() => this.params().get('q') ?? '');
  readonly status = computed(() => pick(STATUSES, this.params().get('status'), 'active'));
  readonly sortKey = computed<SortKey>(() => pick(SORT_KEYS, this.params().get('sort'), 'name'));
  readonly sortDir = computed<SortDir>(() => (this.params().get('dir') === 'desc' ? 'desc' : 'asc'));
  readonly coverage = computed<CoverageFilter>(() => pick(COVERAGE_FILTERS, this.params().get('cov'), 'all'));
  readonly category = computed<CategoryFilter>(() => pick(CATEGORY_FILTERS, this.params().get('cat'), 'all'));

  /** ローマ字の列（A〜Z）を姓と名のどちらで並べるか（見た目だけなので URL には入れない） */
  readonly romanBy = signal<RomanBy>('last');

  // ===== 区分（選んだときだけ契約を読む） =====
  private readonly contracts = signal<Map<string, ContractDoc[]> | null>(null);
  private readonly criteria = signal<CriteriaDoc[]>([]);
  readonly categoryLoading = signal(false);

  /** 今日の区分（契約を読んだあとだけ） */
  readonly classifications = computed<Map<string, Classification> | null>(() => {
    const map = this.contracts();
    const o = this.context.current();
    if (!map || !o) return null;
    const office = { standardHours: o.standardHours ?? null, specificApplication: o.specificApplication };
    return new Map(
      this.employees().map((e) => [
        e.id,
        classify(
          { birthDate: e.birthDate, optInDate: e.optInDate, optOutDate: e.optOutDate ?? null, contracts: map.get(e.id) ?? [] },
          office,
          this.criteria(),
          this.today,
        ),
      ]),
    );
  });

  readonly filtered = computed(() => {
    const q = this.query();
    const cat = this.category();
    const classes = this.classifications();
    return this.employees().filter((e) => {
      const retired = this.isRetired(e);
      if (this.status() === 'active' && retired) return false;
      if (this.status() === 'retired' && !retired) return false;
      if (!matchesCoverage(e, this.coverage(), this.thisMonth)) return false;
      if (cat !== 'all' && classes && classes.get(e.id)?.category !== cat) return false;
      return matchesName(e, q);
    });
  });

  /**
   * 氏名の順なら あ〜わ → A〜Z → # の見出しごと（逆順なら見出しごと逆に）
   * ほかの順なら見出しなしの1つのまとまり
   */
  readonly sections = computed<NameSection<Employee>[]>(() => {
    if (this.sortKey() === 'name') {
      const secs = groupByName(this.filtered(), this.romanBy());
      return this.sortDir() === 'asc'
        ? secs
        : [...secs].reverse().map((s) => ({ ...s, items: [...s.items].reverse() }));
    }
    return [{ label: '', items: sortEmployees(this.filtered(), this.sortKey(), this.sortDir()) }];
  });
  /** ローマ字の列に並ぶ人がいるときだけ「姓／名」の切り替えを出す */
  readonly hasRoman = computed(
    () => this.sortKey() === 'name' && this.sections().some((s) => /^[A-Z]$/.test(s.label)),
  );

  constructor() {
    // 事業所が切り替わったら読み直す
    effect(() => {
      const officeId = this.context.current()?.id;
      if (officeId) this.load(officeId);
    });
    // 区分で絞り込むときだけ、契約を読む
    effect(() => {
      const officeId = this.context.current()?.id;
      if (officeId && this.category() !== 'all' && !this.contracts() && !this.loading()) {
        this.loadContracts(officeId);
      }
    });
  }

  private async load(officeId: string): Promise<void> {
    this.loading.set(true);
    this.contracts.set(null);
    try {
      this.employees.set(await this.employeesApi.list(officeId));
    } catch (err) {
      console.error(err);
      this.employees.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadContracts(officeId: string): Promise<void> {
    if (this.categoryLoading()) return;
    this.categoryLoading.set(true);
    try {
      const list = this.employees();
      const [criteria, lists] = await Promise.all([
        this.criteriaApi.list(),
        Promise.all(list.map((e) => this.contractsApi.list(officeId, e.id))),
      ]);
      this.criteria.set(criteria);
      this.contracts.set(new Map(list.map((e, i) => [e.id, lists[i]])));
    } catch (err) {
      console.error(err);
    } finally {
      this.categoryLoading.set(false);
    }
  }

  // ===== URL を書き換える =====

  private setQuery(queryParams: Record<string, string | null>): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true, // 1文字打つたびに履歴が増えないように
    });
  }

  onQuery(event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    this.setQuery({ q: v || null });
  }

  setStatus(s: StatusFilter): void {
    this.setQuery({ status: s === 'active' ? null : s });
  }

  setCoverage(c: CoverageFilter): void {
    this.setQuery({ cov: c === 'all' ? null : c });
  }

  setCategory(c: string): void {
    this.setQuery({ cat: c === 'all' ? null : c });
  }

  /** 見出しを押す：同じ列なら向きを変える、違う列ならその列の昇順 */
  sortBy(key: SortKey): void {
    const dir: SortDir = this.sortKey() === key && this.sortDir() === 'asc' ? 'desc' : 'asc';
    this.setQuery({ sort: key === 'name' ? null : key, dir: dir === 'asc' ? null : dir });
  }

  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (this.sortKey() !== key) return 'none';
    return this.sortDir() === 'asc' ? 'ascending' : 'descending';
  }

  // ===== 表示 =====

  /** 退職日を過ぎていれば退職者（未来の退職日は「退職予定」で在籍中に含める） */
  isRetired(e: Employee): boolean {
    return !!e.retireDate && e.retireDate < this.today;
  }

  age(e: Employee): number {
    return ageAt(e.birthDate, this.today);
  }

  categoryOf(e: Employee): Category | null {
    return this.classifications()?.get(e.id)?.category ?? null;
  }
}
