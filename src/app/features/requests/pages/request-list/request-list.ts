import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { map } from 'rxjs';
import { Employee } from '../../../../core/models/employee';
import { EmployeeRequest, REQUEST_STATUSES, RequestStatus } from '../../../../core/models/office-records';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import { sortRequests } from '../../logic/request-model';
import { RequestService } from '../../request.service';

type Filter = RequestStatus | 'all';

/** 依頼と申請の一覧（確認待ちが上）。状態の絞り込みは URL（?status=）に持つ */
@Component({
  selector: 'app-request-list',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './request-list.html',
  styleUrl: '../requests.css',
})
export class RequestList {
  private readonly api = inject(RequestService);
  private readonly employeesApi = inject(EmployeeService);
  private readonly route = inject(ActivatedRoute);
  readonly context = inject(OfficeContext);

  readonly statuses = REQUEST_STATUSES;
  readonly filter = toSignal(
    this.route.queryParamMap.pipe(map((q) => (q.get('status') as Filter | null) ?? 'all')),
    { initialValue: 'all' as Filter },
  );

  readonly requests = signal<EmployeeRequest[]>([]);
  private readonly employees = signal<Map<string, Employee>>(new Map());
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);

  readonly counts = computed(() => {
    const c: Record<string, number> = { all: this.requests().length };
    for (const r of this.requests()) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  });

  readonly rows = computed(() => {
    const f = this.filter();
    const list = this.requests().filter((r) => f === 'all' || r.status === f);
    return sortRequests(list.map((r) => ({ ...r, updatedMs: r.updatedAt?.toMillis() ?? 0 })));
  });

  constructor() {
    effect(() => {
      const office = this.context.current();
      if (office) this.load(office.id);
    });
  }

  private async load(officeId: string): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const [requests, employees] = await Promise.all([this.api.listAll(officeId), this.employeesApi.list(officeId)]);
      this.requests.set(requests);
      this.employees.set(new Map(employees.map((e) => [e.id, e])));
    } catch (err) {
      console.error(err);
      this.errorKey.set('request.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  nameOf(employeeId: string): string {
    const e = this.employees().get(employeeId);
    return e ? `${e.lastName} ${e.firstName}`.trim() : '—';
  }

  numberOf(employeeId: string): string | null {
    return this.employees().get(employeeId)?.employeeNumber ?? null;
  }

  updated(r: EmployeeRequest): string {
    return r.updatedAt ? r.updatedAt.toDate().toLocaleDateString() : '';
  }
}
