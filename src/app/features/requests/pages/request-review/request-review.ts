import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { EmployeeRequest } from '../../../../core/models/office-records';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import { AnswerView } from '../../components/answer-view/answer-view';
import { currentValue, planApply, REQUEST_FIELDS } from '../../logic/request-model';
import { RequestService } from '../../request.service';

/**
 * 依頼・申請の確認：今の値と答えを並べ、承認（従業員の情報に書き込む）か差し戻し（理由つき）
 * 承認で書き換わる項目は、押す前に一覧で見せる
 */
@Component({
  selector: 'app-request-review',
  imports: [AnswerView, RouterLink, TranslocoPipe],
  templateUrl: './request-review.html',
  styleUrl: '../requests.css',
})
export class RequestReview {
  private readonly api = inject(RequestService);
  private readonly employeesApi = inject(EmployeeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  readonly context = inject(OfficeContext);

  readonly request = signal<EmployeeRequest | null>(null);
  readonly employee = signal<Employee | null>(null);
  readonly loading = signal(true);
  readonly working = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly comment = signal('');
  readonly confirmingDelete = signal(false);
  readonly triedReject = signal(false);

  /** 今の値（書き込み先のある項目だけ） */
  readonly current = computed<Record<string, string | null> | null>(() => {
    const e = this.employee();
    if (!e) return null;
    return Object.fromEntries(REQUEST_FIELDS.map((f) => [f, currentValue(e, f)]));
  });

  /** 承認したら書き換わる項目 */
  readonly changes = computed(() => {
    const r = this.request();
    const e = this.employee();
    return r && e ? planApply(e, r.questions, r.answers).changes : [];
  });

  readonly canDecide = computed(() => this.request()?.status === 'submitted' && this.context.isAdmin());

  constructor() {
    effect(() => {
      const office = this.context.current();
      const id = this.route.snapshot.paramMap.get('requestId');
      if (office && id) this.load(office.id, id);
    });
  }

  private async load(officeId: string, id: string): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const r = await this.api.get(officeId, id);
      this.request.set(r);
      if (r) this.employee.set(await this.employeesApi.get(officeId, r.employeeId));
    } catch (err) {
      console.error(err);
      this.errorKey.set('request.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  async approve(): Promise<void> {
    const officeId = this.context.current()?.id;
    const r = this.request();
    if (!officeId || !r || this.working()) return;
    this.working.set(true);
    this.errorKey.set(null);
    try {
      const title = this.transloco.translate('request.notice.approved', { title: r.title });
      await this.api.approve(officeId, r, this.comment() || null, title);
      await this.load(officeId, r.id);
    } catch (err) {
      console.error(err);
      this.errorKey.set('request.error.approve');
    } finally {
      this.working.set(false);
    }
  }

  async reject(): Promise<void> {
    this.triedReject.set(true);
    const officeId = this.context.current()?.id;
    const r = this.request();
    if (!officeId || !r || this.working() || !this.comment().trim()) return;
    this.working.set(true);
    this.errorKey.set(null);
    try {
      const title = this.transloco.translate('request.notice.rejected', { title: r.title });
      await this.api.reject(officeId, r, this.comment(), title);
      await this.load(officeId, r.id);
    } catch (err) {
      console.error(err);
      this.errorKey.set('request.error.reject');
    } finally {
      this.working.set(false);
    }
  }

  async remove(): Promise<void> {
    const officeId = this.context.current()?.id;
    const r = this.request();
    if (!officeId || !r || this.working()) return;
    this.working.set(true);
    try {
      await this.api.remove(officeId, r.id);
      await this.router.navigate(['/o', officeId, 'requests']);
    } catch (err) {
      console.error(err);
      this.errorKey.set('request.error.delete');
      this.working.set(false);
    }
  }

  nameOf(e: Employee): string {
    return `${e.lastName} ${e.firstName}`.trim();
  }
}
