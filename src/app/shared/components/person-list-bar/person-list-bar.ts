import { Component, computed, ElementRef, input, model, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EMPLOYMENT_TYPES, PAY_TYPES } from '../../../core/models/contract';
import {
  COVERAGE_OPTIONS,
  emptyFilter,
  EmployeeFilter,
  NATIONALITY_OPTIONS,
  SEX_OPTIONS,
  toggle,
} from '../../../features/employees/logic/employee-filter';
import { ENTRY_STATES, listFilterCount, PersonListOptions } from '../../logic/person-list';
import { Pager } from '../pager/pager';

type ListField = 'coverage' | 'sex' | 'nationality';
const ORDERS: Record<ListField, readonly string[]> = {
  coverage: COVERAGE_OPTIONS,
  sex: SEX_OPTIONS,
  nationality: NATIONALITY_OPTIONS,
};

/**
 * 人の並ぶ表の上の帯（給与の入力・賞与の登録・マイページの発行・保険料一覧。11/13 に作り直し）
 * 従業員の一覧と同じ形にそろえる：「絞り込み」ボタン（パネル）＋ 探す ＋ ページ送り
 * - 並べ替えは表の見出し（app-sort-header）で行う
 * - 画面だけの条件は、パネルの一番上に差し込む（ng-content）
 * - 値は親が持つ（options・page を双方向で受け渡す）。絞ると1ページ目に戻す
 */
@Component({
  selector: 'app-person-list-bar',
  imports: [Pager, TranslocoPipe],
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'open.set(false)',
  },
  template: `
    <div class="toolbar">
      <div class="filter-wrap" #wrap>
        <button type="button" class="btn filter-btn" [class.on]="count() > 0" [attr.aria-expanded]="open()" (click)="open.set(!open())">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 3.5h12L9.5 9v4l-3 1.5V9z" /></svg>
          {{ 'employee.filter.button' | transloco }}
          @if (count() > 0) { <span class="count">{{ count() }}</span> }
        </button>

        @if (open()) {
          @let f = options().filter;
          <div class="filter-panel" animate.enter="panel-enter" animate.leave="panel-leave">
            <div class="filter-head">
              <strong>{{ 'employee.filter.title' | transloco }}</strong>
              <button type="button" class="link" (click)="clear()">{{ 'employee.filter.clear' | transloco }}</button>
            </div>

            <!-- この画面だけの条件（マイページの状態など） -->
            <ng-content />

            @if (showEntry()) {
              <fieldset>
                <legend>{{ 'personList.entry' | transloco }}</legend>
                @for (s of entryStates; track s) {
                  <label class="opt"><input type="radio" name="entry" [checked]="options().entry === s" (change)="set('entry', s)" />{{ entryKey() + s | transloco }}</label>
                }
              </fieldset>
            }

            @if (showContract()) {
              <fieldset>
                <legend>{{ 'employee.filter.employment' | transloco }}</legend>
                <label class="opt"><input type="radio" name="employment" [checked]="options().employment === 'all'" (change)="set('employment', 'all')" />{{ 'personList.allEmployment' | transloco }}</label>
                @for (t of employmentTypes; track t) {
                  <label class="opt"><input type="radio" name="employment" [checked]="options().employment === t" (change)="set('employment', t)" />{{ 'contract.employmentType.' + t | transloco }}</label>
                }
              </fieldset>
              <fieldset>
                <legend>{{ 'personList.payType' | transloco }}</legend>
                <label class="opt"><input type="radio" name="payType" [checked]="options().payType === 'all'" (change)="set('payType', 'all')" />{{ 'personList.allPayType' | transloco }}</label>
                @for (t of payTypes; track t) {
                  <label class="opt"><input type="radio" name="payType" [checked]="options().payType === t" (change)="set('payType', t)" />{{ 'contract.payType.' + t | transloco }}</label>
                }
              </fieldset>
            }

            <fieldset>
              <legend>{{ 'employee.filter.coverage' | transloco }}</legend>
              @for (o of coverage; track o) {
                <label class="opt"><input type="checkbox" [checked]="isOn('coverage', o)" (change)="toggleOption('coverage', o)" />{{ 'employee.filter.cov.' + o | transloco }}</label>
              }
            </fieldset>

            <fieldset class="range">
              <legend>{{ 'employee.filter.hire' | transloco }}</legend>
              <input class="input" type="date" [value]="f.hireFrom ?? ''" (change)="setFilter({ hireFrom: $any($event.target).value || null })" [attr.aria-label]="'employee.filter.from' | transloco" />
              <span>〜</span>
              <input class="input" type="date" [value]="f.hireTo ?? ''" (change)="setFilter({ hireTo: $any($event.target).value || null })" [attr.aria-label]="'employee.filter.to' | transloco" />
            </fieldset>

            <fieldset class="range">
              <legend>{{ 'employee.filter.age' | transloco }}</legend>
              <input class="input age" inputmode="numeric" maxlength="3" [value]="f.ageMin ?? ''" (change)="setAge('ageMin', $any($event.target).value)" [attr.aria-label]="'employee.filter.from' | transloco" />
              <span>〜</span>
              <input class="input age" inputmode="numeric" maxlength="3" [value]="f.ageMax ?? ''" (change)="setAge('ageMax', $any($event.target).value)" [attr.aria-label]="'employee.filter.to' | transloco" />
              <span class="muted">{{ 'employee.filter.ageUnit' | transloco }}</span>
            </fieldset>

            <fieldset>
              <legend>{{ 'employee.filter.sex' | transloco }}</legend>
              @for (o of sex; track o) {
                <label class="opt"><input type="checkbox" [checked]="isOn('sex', o)" (change)="toggleOption('sex', o)" />{{ 'employee.filter.sexOpt.' + o | transloco }}</label>
              }
            </fieldset>

            <fieldset>
              <legend>{{ 'employee.filter.nationality' | transloco }}</legend>
              @for (o of nationality; track o) {
                <label class="opt"><input type="checkbox" [checked]="isOn('nationality', o)" (change)="toggleOption('nationality', o)" />{{ 'employee.filter.nat.' + o | transloco }}</label>
              }
            </fieldset>

            <p class="hint">{{ 'employee.filter.hint' | transloco }}</p>
          </div>
        }
      </div>
      <input
        class="input search"
        type="search"
        [placeholder]="'personList.search' | transloco"
        [attr.aria-label]="'personList.search' | transloco"
        [value]="options().query"
        (input)="set('query', $any($event.target).value)"
      />
    </div>
    <app-pager [total]="total()" [page]="page()" (pageChange)="page.set($event)" [size]="options().size" (sizeChange)="set('size', $event)" />
  `,
  styles: `
    :host { display: block; margin-bottom: var(--space-sm); }
    .toolbar { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-bottom: var(--space-sm); }
    .search { flex: 1; min-width: 200px; }
    .muted { color: var(--color-text-sub); }
  `,
})
export class PersonListBar {
  readonly options = model.required<PersonListOptions>();
  readonly page = model.required<number>();
  /** 絞ったあとの人数 */
  readonly total = input.required<number>();
  /** 使わなくなった（ページの数は app-pager が出す）。呼ぶ側の書き換えを減らすため残す */
  readonly pages = input<number>(1);
  /** 「入れたかどうか」の言い方（給与：payroll、賞与：bonus） */
  readonly entryKey = input('personList.entryState.');
  /** 雇用形態・給与の形で絞る欄を出すか（契約を読まない画面では出さない） */
  readonly showContract = input(true);
  /** 「入れたかどうか」の欄を出すか */
  readonly showEntry = input(true);
  /** 画面だけの条件を使っている数（ボタンの数に足す） */
  readonly extraCount = input(0);

  readonly open = signal(false);
  private readonly wrap = viewChild<ElementRef<HTMLElement>>('wrap');

  readonly employmentTypes = EMPLOYMENT_TYPES;
  readonly payTypes = PAY_TYPES;
  readonly entryStates = ENTRY_STATES;
  readonly coverage = COVERAGE_OPTIONS;
  readonly sex = SEX_OPTIONS;
  readonly nationality = NATIONALITY_OPTIONS;

  readonly count = computed(() => listFilterCount(this.options()) + this.extraCount());

  set<K extends keyof PersonListOptions>(key: K, value: PersonListOptions[K]): void {
    this.options.set({ ...this.options(), [key]: value });
    this.page.set(1);
  }

  setFilter(patch: Partial<EmployeeFilter>): void {
    this.set('filter', { ...this.options().filter, ...patch });
  }

  isOn(field: ListField, value: string): boolean {
    return (this.options().filter[field] as readonly string[]).includes(value);
  }

  toggleOption(field: ListField, value: string): void {
    const next = toggle(this.options().filter[field] as string[], value, ORDERS[field]);
    this.setFilter({ [field]: next } as Partial<EmployeeFilter>);
  }

  setAge(field: 'ageMin' | 'ageMax', value: string): void {
    const v = value.normalize('NFKC').trim();
    this.setFilter({ [field]: /^\d{1,3}$/.test(v) ? Number(v) : null });
  }

  /** 条件をクリア（探す言葉・並び・表示人数はそのまま） */
  clear(): void {
    this.options.set({ ...this.options(), filter: emptyFilter(), employment: 'all', payType: 'all', entry: 'all' });
    this.page.set(1);
  }

  onDocumentClick(event: MouseEvent): void {
    const el = this.wrap()?.nativeElement;
    if (this.open() && el && !el.contains(event.target as Node)) this.open.set(false);
  }
}
