import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { Payroll } from '../../../../core/models/payroll';
import { RemunerationDoc, RemunerationInput, StandardRemuneration } from '../../../../core/models/remuneration';
import { IrregularDecision, LeaveEndDecision } from '../../../../core/models/revision';
import { todayLocal, toYearMonth, shiftMonth } from '../../../../shared/utils/date';
import { ContractService } from '../../../employees/contract.service';
import { EmployeeService } from '../../../employees/employee.service';
import { RemunerationService } from '../../../employees/remuneration.service';
import { CriteriaService } from '../../../office/criteria.service';
import { OfficeContext } from '../../../office/office-context.service';
import { payrollOf } from '../../../office/office-settings';
import { RateService } from '../../../rates/rate.service';
import { InsuranceJudgement, standardAt } from '../../logic/revision-base';
import {
  groupOf,
  RevisionGroup,
  RevisionItem,
  revisionFromMonth,
  revisionItems,
} from '../../logic/revision-rows';
import { PayrollService } from '../../payroll.service';
import { RevisionService } from '../../revision.service';

interface View {
  key: string; // 行の目印（従業員ID・種類・起算月）
  employee: Employee;
  item: RevisionItem;
  group: RevisionGroup;
  remunerations: RemunerationDoc[];
}

/**
 * 改定の候補（随時改定・産休／育休の終了時改定）
 * 給与の実績を入れたあとに開く。候補を確かめて「反映」すると、改定の記録と標準報酬を同時に書く
 * 結果は保存せず、開くたびに計算する（反映した分は「反映済み」に出る）
 */
@Component({
  selector: 'app-revisions',
  imports: [NgTemplateOutlet, RouterLink, TranslocoPipe],
  templateUrl: './revisions.html',
  styleUrl: './revisions.css',
})
export class RevisionsPage {
  private readonly employeesApi = inject(EmployeeService);
  private readonly payrollApi = inject(PayrollService);
  private readonly remunerationApi = inject(RemunerationService);
  private readonly contractApi = inject(ContractService);
  private readonly criteriaApi = inject(CriteriaService);
  private readonly rates = inject(RateService);
  private readonly api = inject(RevisionService);
  readonly context = inject(OfficeContext);

  readonly today = todayLocal();
  readonly fromMonth = revisionFromMonth(toYearMonth(this.today));

  readonly views = signal<View[]>([]);
  readonly loading = signal(true);
  readonly saving = signal<string | null>(null);
  readonly errorKey = signal<string | null>(null);
  readonly savedKey = signal<string | null>(null);
  readonly showOther = signal(false);
  /** 休業終了時改定：本人から申出を受けた日（行ごと。初期値は今日） */
  readonly requested = signal<Record<string, string>>({});

  readonly groups = computed(() => {
    const by = (g: RevisionGroup) => this.views().filter((v) => v.group === g);
    return {
      candidate: by('candidate'),
      waiting: by('waiting'),
      reflected: by('reflected'),
      other: by('other'),
    };
  });

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const [all, tables, criteria] = await Promise.all([
        this.employeesApi.list(office.id),
        this.rates.grades(),
        this.criteriaApi.list(),
      ]);
      // 出し始める月より前に辞めた人は読まない（読む回数を減らす）
      const employees = all.filter((e) => !e.retireDate || e.retireDate >= `${this.fromMonth}-01`);
      const perPerson = await Promise.all(
        employees.map(async (e) => {
          const [payrolls, remunerations, contracts] = await Promise.all([
            this.payrollApi.listOfEmployee(office.id, e.id),
            this.remunerationApi.list(office.id, e.id),
            this.contractApi.list(office.id, e.id),
          ]);
          return { e, payrolls, remunerations, contracts };
        }),
      );
      const ctx = {
        office: { standardHours: office.standardHours ?? null, specificApplication: office.specificApplication },
        criteria,
        schedule: payrollOf(office),
        gradeTables: tables,
        fromMonth: this.fromMonth,
      };
      const views: View[] = [];
      for (const { e, payrolls, remunerations, contracts } of perPerson) {
        const items = revisionItems(
          {
            employee: e,
            contracts,
            payrolls: new Map(payrolls.map((p: Payroll): [string, Payroll] => [p.paidMonth, p])),
            remunerations,
          },
          ctx,
        );
        for (const item of items) {
          const start = item.type === 'leaveEnd' ? item.result.startMonth : item.result.start.month;
          views.push({
            key: `${e.id}_${item.type}_${start}`,
            employee: e,
            item,
            group: groupOf(item),
            remunerations,
          });
        }
      }
      // 改定月の順。同じ月なら休業終了時改定が先（優先順位）
      views.sort(
        (a, b) =>
          a.item.result.revisedFrom.localeCompare(b.item.result.revisedFrom) ||
          (a.item.type === b.item.type ? 0 : a.item.type === 'leaveEnd' ? -1 : 1),
      );
      this.views.set(views);
    } catch (err) {
      console.error(err);
      this.errorKey.set('revision.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  // ===== 反映 =====

  requestedOf(v: View): string {
    return this.requested()[v.key] ?? this.today;
  }

  setRequested(v: View, date: string): void {
    this.requested.update((r) => ({ ...r, [v.key]: date }));
  }

  canReflect(v: View): boolean {
    if (!this.context.isAdmin() || v.group !== 'candidate' || this.saving()) return false;
    return v.item.type === 'irregular' || /^\d{4}-\d{2}-\d{2}$/.test(this.requestedOf(v));
  }

  /** 改定後の標準報酬（改定しない保険は今のまま。厚年の資格がない人は今の値を持っておく） */
  private after(v: View): { health: StandardRemuneration; pension: StandardRemuneration } {
    const r = v.item.result;
    const cur = standardAt(v.remunerations, shiftMonth(r.revisedFrom, -1))!;
    const pick = (j: InsuranceJudgement | null, fallback: StandardRemuneration) =>
      j && j.revise ? j.after : fallback;
    return { health: pick(r.health, cur.health), pension: pick(r.pension, cur.pension) };
  }

  async reflect(v: View): Promise<void> {
    if (!this.canReflect(v)) return;
    const office = this.context.current()!;
    const r = v.item.result;
    const avg = r.average!;
    const { health, pension } = this.after(v);
    const remuneration: RemunerationInput = {
      from: r.revisedFrom,
      reason: v.item.type === 'irregular' ? 'irregular' : 'leaveEnd',
      monthlyAmount: avg.corrected,
      health,
      pension,
    };
    const common = {
      officeId: office.id,
      employeeId: v.employee.id,
      revisedFrom: r.revisedFrom,
      usedMonths: r.months.filter((m) => m.used).map((m) => m.month),
      total: avg.total,
      average: avg.average,
      monthlyAmount: avg.corrected,
      health,
      pension,
    };

    this.saving.set(v.key);
    this.errorKey.set(null);
    this.savedKey.set(null);
    try {
      if (v.item.type === 'irregular') {
        const ir = v.item.result;
        const diff = ir.health?.diff ?? 0;
        const decision: IrregularDecision = {
          ...common,
          startMonth: ir.start.month,
          direction: ir.start.direction === 'unclear' ? (diff >= 0 ? 'up' : 'down') : ir.start.direction,
          corrected: avg.retro > 0 ? avg.corrected : null,
          retro: avg.retro,
          special: !!(ir.health?.revise && ir.health.special) || !!(ir.pension?.revise && ir.pension.special),
          reasonNote: null,
        };
        await this.api.reflectIrregular(decision, remuneration);
      } else {
        const le = v.item.result;
        const decision: LeaveEndDecision = {
          ...common,
          startMonth: le.startMonth,
          leaveKind: le.kind,
          leaveEnd: le.leaveEnd,
          requestedOn: this.requestedOf(v),
        };
        await this.api.reflectLeaveEnd(decision, remuneration);
      }
      await this.load();
      this.savedKey.set('revision.saved');
    } catch (err) {
      console.error(err);
      this.errorKey.set('revision.error.save');
    } finally {
      this.saving.set(null);
    }
  }

  // ===== 表示 =====

  readonly name = (e: Employee) => `${e.lastName} ${e.firstName}`;
  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  readonly diffLabel = (d: number) => (d > 0 ? `+${d}` : String(d));

  typeKey(v: View): string {
    return v.item.type === 'irregular' ? 'revision.type.irregular' : `revision.type.${v.item.result.kind}`;
  }

  startOf(v: View): string {
    return v.item.type === 'leaveEnd' ? v.item.result.startMonth : v.item.result.start.month;
  }

  /** あと何か月分の実績が要るか（waiting のとき） */
  missingOf(v: View): number {
    return v.item.result.months.filter((m) => !m.payroll).length;
  }
}
