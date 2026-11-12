import { Component, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Dependent } from '../../../../core/models/dependent';
import { EmployeeFull } from '../../../../core/models/employee';
import { MyNumberStatus } from '../../../../core/models/my-number';
import { DependentService } from '../../../employees/dependent.service';
import { OfficeContext } from '../../../office/office-context.service';
import { MyNumberService } from '../../my-number.service';
import { MyNumberCard } from '../my-number-card/my-number-card';

/**
 * 家族（被扶養者）のマイナンバー（管理者だけ。11/12）
 * 開いたときにだけ家族と状態を読む（ふだんの従業員の詳細では読み込みを増やさない）
 * 1人ずつ、従業員本人と同じカード（登録・依頼・承認・全桁・廃棄・記録）を出す
 */
@Component({
  selector: 'app-family-my-numbers',
  imports: [MyNumberCard, TranslocoPipe],
  template: `
    @if (context.isAdmin()) {
      <details class="card family" (toggle)="onToggle($event)">
        <summary>
          <h2>{{ 'myNumber.family.title' | transloco }}</h2>
        </summary>
        <p class="hint">{{ 'myNumber.family.lead' | transloco }}</p>
        @if (errorKey(); as e) {
          <p class="field-error" role="alert">{{ e | transloco }}</p>
        }
        @if (dependents(); as list) {
          @for (d of list; track d.id) {
            <app-my-number-card [employee]="employee()" [dependent]="d" [selfStatus]="selfStatus()" />
          } @empty {
            <p class="muted">{{ 'myNumber.family.empty' | transloco }}</p>
          }
        } @else if (opened()) {
          <p class="muted">{{ 'common.loading' | transloco }}</p>
        }
      </details>
    }
  `,
  styles: `
    :host { display: block; }
    .family { margin-bottom: var(--space-lg); }
    summary { cursor: pointer; }
    summary h2 { display: inline; margin: 0; font-size: var(--font-md); }
    .hint, .muted { font-size: var(--font-sm); color: var(--color-text-sub); }
  `,
})
export class FamilyMyNumbers {
  private readonly dependentsApi = inject(DependentService);
  private readonly api = inject(MyNumberService);
  readonly context = inject(OfficeContext);
  readonly employee = input.required<EmployeeFull>();

  readonly opened = signal(false);
  readonly dependents = signal<Dependent[] | null>(null);
  readonly selfStatus = signal<MyNumberStatus | null>(null);
  readonly errorKey = signal<string | null>(null);

  async onToggle(e: Event): Promise<void> {
    const open = (e.target as HTMLDetailsElement).open;
    this.opened.set(open);
    if (open && !this.dependents()) await this.load();
  }

  private async load(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId) return;
    this.errorKey.set(null);
    try {
      const id = this.employee().id;
      const [list, self] = await Promise.all([this.dependentsApi.list(officeId, id), this.api.entry(officeId, id)]);
      // 扶養中の人を先に（外れた人は、番号の廃棄のために後ろに出す）
      this.dependents.set([...list].sort((a, b) => Number(!!a.to) - Number(!!b.to) || a.from.localeCompare(b.from)));
      this.selfStatus.set(self?.status ?? null);
    } catch (err) {
      console.error(err);
      this.errorKey.set('myNumber.error.load');
    }
  }
}
