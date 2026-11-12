import { Component, input, model } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { EMPLOYMENT_TYPES, PAY_TYPES } from '../../../core/models/contract';
import { ENTRY_STATES, PERSON_SORTS, PersonListOptions } from '../../logic/person-list';

/**
 * 人の並ぶ表の上の帯：探す・絞る・並べる・ページ（給与の入力・賞与の登録。11/12）
 * 値は親が持つ（options・page を双方向で受け渡す）。絞ると1ページ目に戻す
 * 契約を読まない画面は showContract・showEntry を false にし、独自の絞り込みは中に差し込む（ng-content）
 */
@Component({
  selector: 'app-person-list-bar',
  imports: [TranslocoPipe],
  template: `
    <div class="bar">
      <input
        class="input search"
        type="search"
        [placeholder]="'personList.search' | transloco"
        [attr.aria-label]="'personList.search' | transloco"
        [value]="options().query"
        (input)="set('query', $any($event.target).value)"
      />
      @if (showContract()) {
      <select class="input" [attr.aria-label]="'personList.employment' | transloco" (change)="set('employment', $any($event.target).value)">
        <option value="all" [selected]="options().employment === 'all'">{{ 'personList.allEmployment' | transloco }}</option>
        @for (t of employmentTypes; track t) {
          <option [value]="t" [selected]="options().employment === t">{{ 'contract.employmentType.' + t | transloco }}</option>
        }
      </select>
      <select class="input" [attr.aria-label]="'personList.payType' | transloco" (change)="set('payType', $any($event.target).value)">
        <option value="all" [selected]="options().payType === 'all'">{{ 'personList.allPayType' | transloco }}</option>
        @for (t of payTypes; track t) {
          <option [value]="t" [selected]="options().payType === t">{{ 'contract.payType.' + t | transloco }}</option>
        }
      </select>
      }
      @if (showEntry()) {
      <select class="input" [attr.aria-label]="'personList.entry' | transloco" (change)="set('entry', $any($event.target).value)">
        @for (s of entryStates; track s) {
          <option [value]="s" [selected]="options().entry === s">{{ entryKey() + s | transloco }}</option>
        }
      </select>
      }
      <!-- 親の画面だけの絞り込み（マイページの状態など） -->
      <ng-content />
      <select class="input" [attr.aria-label]="'personList.sort' | transloco" (change)="set('sort', $any($event.target).value)">
        @for (s of sorts; track s) {
          <option [value]="s" [selected]="options().sort === s">{{ 'personList.sortBy.' + s | transloco }}</option>
        }
      </select>
    </div>
    <div class="pager">
      <span class="count">{{ 'personList.count' | transloco: { n: total() } }}</span>
      @if (pages() > 1) {
        <button type="button" class="btn" [disabled]="page() <= 1" (click)="page.set(page() - 1)" [attr.aria-label]="'personList.prev' | transloco">‹</button>
        <span>{{ 'personList.page' | transloco: { page: page(), pages: pages() } }}</span>
        <button type="button" class="btn" [disabled]="page() >= pages()" (click)="page.set(page() + 1)" [attr.aria-label]="'personList.next' | transloco">›</button>
      }
    </div>
  `,
  styles: `
    :host { display: block; margin-bottom: var(--space-sm); }
    .bar { display: flex; flex-wrap: wrap; gap: var(--space-sm); align-items: center; }
    .bar .input { width: auto; min-width: 9em; }
    .bar .search { flex: 1 1 14em; }
    .pager { display: flex; align-items: center; gap: var(--space-sm); margin-top: var(--space-xs); font-size: var(--font-sm); }
    .pager .count { margin-right: auto; color: var(--color-text-sub); }
    .pager .btn { width: 36px; padding: 0; }
  `,
})
export class PersonListBar {
  readonly options = model.required<PersonListOptions>();
  readonly page = model.required<number>();
  /** 絞ったあとの人数 */
  readonly total = input.required<number>();
  readonly pages = input.required<number>();
  /** 「入れたかどうか」の言い方（給与：payroll、賞与：bonus） */
  readonly entryKey = input('personList.entryState.');
  /** 雇用形態・給与の形で絞る欄を出すか（契約を読まない画面では出さない） */
  readonly showContract = input(true);
  /** 「入れたかどうか」の欄を出すか */
  readonly showEntry = input(true);

  readonly employmentTypes = EMPLOYMENT_TYPES;
  readonly payTypes = PAY_TYPES;
  readonly entryStates = ENTRY_STATES;
  readonly sorts = PERSON_SORTS;

  set<K extends keyof PersonListOptions>(key: K, value: PersonListOptions[K]): void {
    this.options.set({ ...this.options(), [key]: value });
    this.page.set(1);
  }
}
