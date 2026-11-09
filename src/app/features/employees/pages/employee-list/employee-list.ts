import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
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
import { SORT_KEYS, SortDir, SortKey, sortEmployees } from '../../logic/employee-sort';
import { contractAt } from '../../logic/contract-form-model';
import {
  activeCount,
  CATEGORY_OPTIONS,
  COVERAGE_OPTIONS,
  EMPLOYMENT_OPTIONS,
  EmployeeFilter,
  emptyFilter,
  filterFromQuery,
  filterToQuery,
  matchesFilter,
  NATIONALITY_OPTIONS,
  needsContracts,
  SEX_OPTIONS,
  toggle,
} from '../../logic/employee-filter';
import { groupByName, matchesName, NameSection, RomanBy } from '../../logic/name-index';

import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
type StatusFilter = 'active' | 'retired' | 'all';
const STATUSES: readonly StatusFilter[] = ['active', 'retired', 'all'];

/** フィルターの「どれか」の条件（選択肢の付け外しで使う） */
type ListField = 'coverage' | 'category' | 'employment' | 'sex' | 'nationality';
const ORDERS: Record<ListField, readonly string[]> = {
  coverage: COVERAGE_OPTIONS,
  category: CATEGORY_OPTIONS,
  employment: EMPLOYMENT_OPTIONS,
  sex: SEX_OPTIONS,
  nationality: NATIONALITY_OPTIONS,
};

const pick = <T extends string>(list: readonly T[], v: string | null, fallback: T): T =>
  v && (list as readonly string[]).includes(v) ? (v as T) : fallback;

@Component({
  selector: 'app-employee-list',
  imports: [HalfWidthDigits, RouterLink, TranslocoPipe],
  templateUrl: './employee-list.html',
  styleUrl: './employee-list.css',
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'filterOpen.set(false)',
  },
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
  readonly sortKeys = SORT_KEYS;
  readonly options = {
    coverage: COVERAGE_OPTIONS,
    category: CATEGORY_OPTIONS,
    employment: EMPLOYMENT_OPTIONS,
    sex: SEX_OPTIONS,
    nationality: NATIONALITY_OPTIONS,
  };

  // ===== 表示の状態は URL に持つ（?q=&status=&sort=&dir= と、フィルターの条件） =====
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly query = computed(() => this.params().get('q') ?? '');
  readonly status = computed(() => pick(STATUSES, this.params().get('status'), 'active'));
  /** 並び替え。sort がなければデフォルト（社員番号の昇順） */
  readonly sortKey = computed<SortKey>(() => pick(SORT_KEYS, this.params().get('sort'), 'number'));
  readonly sortDir = computed<SortDir>(() => (this.params().get('dir') === 'desc' ? 'desc' : 'asc'));
  readonly isDefaultSort = computed(() => this.sortKey() === 'number' && this.sortDir() === 'asc');
  readonly filter = computed<EmployeeFilter>(() => filterFromQuery((k) => this.params().get(k)));
  /** 使っている条件の数（在籍は「在籍中」以外を選んだら1つと数える） */
  readonly filterCount = computed(() => activeCount(this.filter()) + (this.status() === 'active' ? 0 : 1));

  /** フィルターのパネル（外を押す・Esc で閉じる） */
  readonly filterOpen = signal(false);
  private readonly filterWrap = viewChild<ElementRef<HTMLElement>>('filterWrap');

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
    const f = this.filter();
    const classes = this.classifications();
    const contracts = this.contracts();
    return this.employees().filter((e) => {
      const retired = this.isRetired(e);
      if (this.status() === 'active' && retired) return false;
      if (this.status() === 'retired' && !retired) return false;
      const ctx = {
        today: this.today,
        month: this.thisMonth,
        // 契約を読み終わるまでは undefined（絞らない）
        category: classes?.get(e.id)?.category,
        employment: contracts ? (contractAt(contracts.get(e.id) ?? [], this.today)?.employmentType ?? null) : undefined,
      };
      return matchesFilter(e, f, ctx) && matchesName(e, q);
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
    // 区分・雇用形態で絞り込むときだけ、契約を読む
    effect(() => {
      const officeId = this.context.current()?.id;
      if (officeId && needsContracts(this.filter()) && !this.contracts() && !this.loading()) {
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

  // ===== フィルター（選んだらすぐ反映） =====

  private setFilter(patch: Partial<EmployeeFilter>): void {
    this.setQuery(filterToQuery({ ...this.filter(), ...patch }));
  }

  isOn(field: ListField, value: string): boolean {
    return (this.filter()[field] as readonly string[]).includes(value);
  }

  toggleOption(field: ListField, value: string): void {
    const next = toggle(this.filter()[field] as string[], value, ORDERS[field]);
    this.setFilter({ [field]: next } as Partial<EmployeeFilter>);
  }

  setDate(field: 'hireFrom' | 'hireTo', value: string): void {
    this.setFilter({ [field]: value || null });
  }

  setAge(field: 'ageMin' | 'ageMax', value: string): void {
    const n = /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : null;
    this.setFilter({ [field]: n });
  }

  /** 条件をクリア（在籍も「在籍中」に戻す） */
  clearFilter(): void {
    this.setQuery({ ...filterToQuery(emptyFilter()), status: null });
  }

  onDocumentClick(event: MouseEvent): void {
    const wrap = this.filterWrap()?.nativeElement;
    if (this.filterOpen() && wrap && !wrap.contains(event.target as Node)) this.filterOpen.set(false);
  }

  /**
   * 見出しを押すたびに回す
   * - 氏名・年齢・入社日：デフォルト → 昇順 → 降順 → デフォルト
   * - 社員番号：デフォルト（＝社員番号の昇順）→ 降順 → デフォルト
   */
  sortBy(key: SortKey): void {
    const same = this.sortKey() === key;
    let next: { sort: SortKey; dir: SortDir } | null; // null ＝ デフォルト
    if (key === 'number') {
      next = this.isDefaultSort() ? { sort: 'number', dir: 'desc' } : null;
    } else if (!same) {
      next = { sort: key, dir: 'asc' };
    } else {
      next = this.sortDir() === 'asc' ? { sort: key, dir: 'desc' } : null;
    }
    this.setQuery(next ? { sort: next.sort, dir: next.dir === 'asc' ? null : 'desc' } : { sort: null, dir: null });
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
