import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { RemunerationDoc } from '../../../../core/models/remuneration';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { formatYen } from '../../../../shared/utils/number';
import { pensionGradeNeeded } from '../../../employees/logic/coverage';
import { EmployeeService } from '../../../employees/employee.service';
import { RemunerationService } from '../../../employees/remuneration.service';
import { OfficeContext } from '../../../office/office-context.service';
import { DecisionNoticeService } from '../../decision-notice.service';
import { DecisionNotice } from '../../logic/decision-notice';

interface Row {
  employee: Employee;
  decision: DecisionNotice;
  sent: boolean;
  hasAccount: boolean;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * 決定通知を本人に届ける（B12・カタログ【5】。11/17）
 * 選んだ月から始まる標準報酬月額（保存済みのもの）がある人を並べ、マイページの受信箱に届ける
 * 開いたときだけ読む（在籍している人の標準報酬を1人1回）
 */
@Component({
  selector: 'app-decision-notice-card',
  imports: [TranslocoPipe],
  templateUrl: './decision-notice-card.html',
  styleUrl: './decision-notice-card.css',
})
export class DecisionNoticeCard implements OnInit {
  private readonly employeesApi = inject(EmployeeService);
  private readonly remunerationApi = inject(RemunerationService);
  private readonly api = inject(DecisionNoticeService);
  readonly context = inject(OfficeContext);

  /** 初めに選んでおく月（定時決定なら9月） */
  readonly initialMonth = input.required<string>();

  readonly month = signal('');
  readonly open = signal(false);
  readonly loading = signal(false);
  readonly sending = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly sentCount = signal<number | null>(null);
  readonly rows = signal<Row[]>([]);
  readonly selected = signal<Set<string>>(new Set());
  readonly yen = formatYen;

  readonly toSend = computed(() => this.rows().filter((r) => this.selected().has(r.employee.id)));

  ngOnInit(): void {
    this.month.set(this.initialMonth());
  }

  readonly name = (e: Employee) => `${e.lastName} ${e.firstName}`.trim();

  async toggle(): Promise<void> {
    this.open.set(!this.open());
    if (this.open() && this.rows().length === 0) await this.load();
  }

  async setMonth(m: string): Promise<void> {
    if (!MONTH.test(m)) return;
    this.month.set(m);
    await this.load();
  }

  private async load(): Promise<void> {
    const office = this.context.current();
    const month = this.month();
    if (!office || !MONTH.test(month)) return;
    this.loading.set(true);
    this.errorKey.set(null);
    this.sentCount.set(null);
    try {
      const employees = (await this.employeesApi.list(office.id)).filter(
        (e) => (e.health.enrolled || e.pension.enrolled) && (!e.retireDate || e.retireDate >= `${month}-01`),
      );
      const [lists, sent] = await Promise.all([
        Promise.all(employees.map((e) => this.remunerationApi.list(office.id, e.id))),
        this.api.sentFor(office.id, month),
      ]);
      const rows: Row[] = [];
      employees.forEach((e, i) => {
        const r = (lists[i] as RemunerationDoc[]).find((x) => x.from === month);
        if (!r) return;
        rows.push({
          employee: e,
          decision: {
            from: r.from,
            reason: r.reason,
            health: e.health.enrolled ? { grade: r.health.grade, standard: r.health.standard } : null,
            pension: pensionGradeNeeded(e, month) ? { grade: r.pension.grade, standard: r.pension.standard } : null,
          },
          sent: sent.has(e.id),
          hasAccount: !!e.userUid,
        });
      });
      rows.sort((a, b) => (a.employee.employeeNumber ?? '').localeCompare(b.employee.employeeNumber ?? ''));
      this.rows.set(rows);
      // 初めは、まだ送っていない人を選んでおく
      this.selected.set(new Set(rows.filter((r) => !r.sent).map((r) => r.employee.id)));
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'decisionNotice.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  check(id: string, on: boolean): void {
    const next = new Set(this.selected());
    if (on) next.add(id);
    else next.delete(id);
    this.selected.set(next);
  }

  checkAll(on: boolean): void {
    this.selected.set(on ? new Set(this.rows().map((r) => r.employee.id)) : new Set());
  }

  async send(): Promise<void> {
    const office = this.context.current();
    const items = this.toSend();
    if (!office || !this.context.isAdmin() || items.length === 0 || this.sending()) return;
    this.sending.set(true);
    this.errorKey.set(null);
    try {
      await this.api.send(office.id, items.map((r) => ({ employeeId: r.employee.id, decision: r.decision })));
      const n = items.length;
      await this.load();
      this.sentCount.set(n);
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'decisionNotice.error.send'));
    } finally {
      this.sending.set(false);
    }
  }
}
