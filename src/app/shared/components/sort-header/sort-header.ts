import { Component, computed, input, model } from '@angular/core';
import { PersonListOptions, PersonSort } from '../../logic/person-list';

/**
 * 並べ替えの見出し（<th> の中に置く。従業員の一覧と同じ「押すと昇順 → もう一度で降順」。11/13）
 * 並びを変えたら1ページ目に戻す
 */
@Component({
  selector: 'app-sort-header',
  template: `
    <button type="button" class="sort" [class.on]="active()" (click)="toggle()">
      <ng-content />
      <span class="arrow" aria-hidden="true">{{ active() ? (options().dir === 'asc' ? '▲' : '▼') : '' }}</span>
    </button>
  `,
  styles: `
    .sort { display: inline-flex; align-items: center; gap: 2px; padding: 0; font: inherit; color: inherit; background: none; border: 0; cursor: pointer; white-space: nowrap; }
    .sort:hover { color: var(--color-text); text-decoration: underline; }
    .sort.on { color: var(--color-text); }
    .arrow { display: inline-block; min-width: 1em; font-size: 0.8em; color: var(--color-primary); }
  `,
  host: { '[attr.aria-sort]': 'null' },
})
export class SortHeader {
  readonly key = input.required<PersonSort>();
  readonly options = model.required<PersonListOptions>();
  readonly page = model<number>(1);

  readonly active = computed(() => this.options().sort === this.key());

  toggle(): void {
    const o = this.options();
    const dir = this.active() && o.dir === 'asc' ? 'desc' : 'asc';
    this.options.set({ ...o, sort: this.key(), dir });
    this.page.set(1);
  }
}
