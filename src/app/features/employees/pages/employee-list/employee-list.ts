import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ContractDoc, EmploymentType } from '../../../../core/models/contract';
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
import { Pager } from '../../../../shared/components/pager/pager';
import { PAGE_SIZE, PAGE_SIZES, PageSize } from '../../../../shared/logic/person-list';
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
  imports: [HalfWidthDigits, Pager, RouterLink, TranslocoPipe],
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
  /** 見出しの前半（社員番号・氏名）と後半（年齢・入社日）。あいだに部署・雇用形態の列を入れる */
  readonly leadKeys: readonly SortKey[] = ['number', 'name'];
  readonly tailKeys: readonly SortKey[] = ['age', 'hire'];
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
  /**
   * 基準日（URL の asOf）：その日の時点の一覧（在籍・区分・加入・年齢）。なければ今日
   * 日付つきの事実（入社日・退職日・契約・加入の日付）から出すので、読み込みは今と同じ
   */
  readonly asOf = computed(() => {
    const v = this.params().get('asOf');
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : this.today;
  });
  readonly asOfMonth = computed(() => toYearMonth(this.asOf()));
  readonly isPast = computed(() => this.asOf() !== this.today);

  /** 部署で絞る（URL の dept。'none' ＝ 部署なし） */
  readonly dept = computed(() => this.params().get('dept') ?? '');
  readonly departments = computed(() => this.context.current()?.departments ?? []);

  setDept(v: string): void {
    this.setQuery({ dept: v || null });
  }

  /** 部署の名前（一覧の表示） */
  deptName(e: Employee): string | null {
    const id = e.org?.departmentId;
    return id ? (this.departments().find((d) => d.id === id)?.name ?? null) : null;
  }

  setAsOf(v: string): void {
    this.setQuery({ asOf: v && v !== this.today ? v : null });
  }

  readonly sortKey = computed<SortKey>(() => pick(SORT_KEYS, this.params().get('sort'), 'number'));
  readonly sortDir = computed<SortDir>(() => (this.params().get('dir') === 'desc' ? 'desc' : 'asc'));
  readonly isDefaultSort = computed(() => this.sortKey() === 'number' && this.sortDir() === 'asc');
  readonly filter = computed<EmployeeFilter>(() => filterFromQuery((k) => this.params().get(k)));
  /** 使っている条件の数（在籍は「在籍中」以外を選んだら1つと数える） */
  readonly filterCount = computed(
    () => activeCount(this.filter()) + (this.status() === 'active' ? 0 : 1) + (this.dept() ? 1 : 0),
  );

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
          this.asOf(),
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
      const dept = this.dept();
      if (dept === 'none' ? !!e.org?.departmentId : dept && e.org?.departmentId !== dept) return false;
      const retired = this.isRetired(e);
      // 基準日にまだ入社していない人は、在籍中に含めない
      if (this.status() === 'active' && (retired || e.hireDate > this.asOf())) return false;
      if (this.status() === 'retired' && !retired) return false;
      const ctx = {
        today: this.asOf(),
        month: this.asOfMonth(),
        // 契約を読み終わるまでは undefined（絞らない）
        category: classes?.get(e.id)?.category,
        employment: contracts ? (contractAt(contracts.get(e.id) ?? [], this.asOf())?.employmentType ?? null) : undefined,
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
  // ===== ページ（URL の page・per。並べ替え・絞り込みのあとで切り分ける。11/13） =====
  readonly pageSize = computed<PageSize>(() => {
    const n = Number(this.params().get('per'));
    return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : PAGE_SIZE;
  });
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));
  readonly page = computed(() => {
    const n = Number(this.params().get('page'));
    return Number.isInteger(n) && n >= 1 ? Math.min(n, this.pageCount()) : 1;
  });

  /** 今のページの分だけ、見出し（あ・か…）ごとにまとめ直す（ページの先頭には、その行の見出しを出す） */
  readonly pagedSections = computed<NameSection<Employee>[]>(() => {
    const flat = this.sections().flatMap((s) => s.items.map((e) => ({ label: s.label, e })));
    const start = (this.page() - 1) * this.pageSize();
    const out: NameSection<Employee>[] = [];
    for (const { label, e } of flat.slice(start, start + this.pageSize())) {
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(e);
      else out.push({ label, items: [e] });
    }
    return out;
  });

  // ===== 雇用形態の列（今のページの人の契約だけ読む。読んだ契約はログイン中は覚えている。11/13） =====
  private readonly pageContracts = signal<Map<string, ContractDoc[]>>(new Map());

  /** 基準日の雇用形態（undefined ＝ まだ読んでいない、null ＝ 契約なし） */
  employmentOf(e: Employee): EmploymentType | null | undefined {
    const list = this.contracts()?.get(e.id) ?? this.pageContracts().get(e.id);
    if (!list) return undefined;
    return contractAt(list, this.asOf())?.employmentType ?? null;
  }

  private async loadPageContracts(officeId: string, ids: readonly string[]): Promise<void> {
    try {
      const lists = await Promise.all(ids.map((id) => this.contractsApi.list(officeId, id)));
      this.pageContracts.update((cur) => {
        const next = new Map(cur);
        ids.forEach((id, i) => next.set(id, lists[i]));
        return next;
      });
    } catch (err) {
      console.error(err);
    }
  }

  setPage(p: number): void {
    this.setQuery({ page: p > 1 ? String(p) : null });
  }

  /** 表示人数を変えた（先頭の1人が入るページへ。URL は1回だけ書き換える） */
  setPer(e: { size: PageSize; page: number }): void {
    this.setQuery({ per: e.size === PAGE_SIZE ? null : String(e.size), page: e.page > 1 ? String(e.page) : null });
  }

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
    // 今のページの人の契約を読む（雇用形態の列。まだ読んでいない人だけ）
    effect(() => {
      const officeId = this.context.current()?.id;
      const ids = this.pagedSections().flatMap((s) => s.items.map((e) => e.id));
      if (!officeId || ids.length === 0) return;
      untracked(() => {
        const all = this.contracts();
        const have = this.pageContracts();
        const todo = ids.filter((id) => !all?.has(id) && !have.has(id));
        if (todo.length > 0) void this.loadPageContracts(officeId, todo);
      });
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
    this.pageContracts.set(new Map());
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

  /** 絞り込み・並びを変えたら1ページ目に戻す（page を渡したときだけ、そのページへ） */
  private setQuery(queryParams: Record<string, string | null>): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: 'page' in queryParams ? queryParams : { ...queryParams, page: null },
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
    this.setQuery({ ...filterToQuery(emptyFilter()), status: null, dept: null });
  }

  onDocumentClick(event: MouseEvent): void {
    const wrap = this.filterWrap()?.nativeElement;
    if (this.filterOpen() && wrap && !wrap.contains(event.target as Node)) this.filterOpen.set(false);
  }

  /**
   * 見出しを押す：別の列なら昇順、同じ列なら昇順 ⇔ 降順（11/13）
   * 押した列で並ぶ。社員番号の順に戻したいときは「社員番号」を押す（社員番号の昇順は URL から消す）
   */
  sortBy(key: SortKey): void {
    const dir: SortDir = this.sortKey() === key && this.sortDir() === 'asc' ? 'desc' : 'asc';
    const isDefault = key === 'number' && dir === 'asc';
    this.setQuery(isDefault ? { sort: null, dir: null } : { sort: key, dir: dir === 'asc' ? null : 'desc' });
  }

  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (this.sortKey() !== key) return 'none';
    return this.sortDir() === 'asc' ? 'ascending' : 'descending';
  }

  // ===== 表示 =====

  /** 退職日を過ぎていれば退職者（未来の退職日は「退職予定」で在籍中に含める） */
  isRetired(e: Employee): boolean {
    return !!e.retireDate && e.retireDate < this.asOf();
  }

  age(e: Employee): number {
    return ageAt(e.birthDate, this.asOf());
  }

  categoryOf(e: Employee): Category | null {
    return this.classifications()?.get(e.id)?.category ?? null;
  }
}
