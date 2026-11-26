import { Injectable, inject } from '@angular/core';
import { Office } from '../../core/models/office';
import { Payroll } from '../../core/models/payroll';
import { monthsBetween, shiftMonth, todayLocal, toYearMonth } from '../../shared/utils/date';
import { ContractService } from '../employees/contract.service';
import { EmployeeService } from '../employees/employee.service';
import { RemunerationService } from '../employees/remuneration.service';
import { CriteriaService } from '../office/criteria.service';
import { payrollAt } from '../office/logic/pay-group';
import { payrollOf } from '../office/office-settings';
import { BonusService } from '../premiums/bonus.service';
import { RateService } from '../rates/rate.service';
import { personRevisions } from './logic/revision-reflect';
import { groupOf, revisionFromMonth } from './logic/revision-rows';
import { PayrollService } from './payroll.service';
import { RevisionService } from './revision.service';

/** 改定の候補の数（ホームの「今月の処理」で使う。11/26） */
export interface RevisionCount {
  /** 3か月そろって改定に当たる（反映していない）人 */
  candidates: string[];
  /** 起算月があり、月がそろうのを待っている人 */
  waiting: string[];
}

/**
 * 改定の候補の画面（revisions.ts の load）と同じ決まりで、候補の人を数える（11/26）
 * - 画面と人数がずれないように、同じ材料（2年分の給与・標準報酬・契約・固定的賃金の変動・賞与）と同じ関数（personRevisions）を使う
 * - 給与は、従業員ごとに読む代わりに、事業所の月ごとの問い合わせでまとめて読む（文書の数は同じ。問い合わせの回数が減る）
 */
@Injectable({ providedIn: 'root' })
export class RevisionCountService {
  private readonly employeesApi = inject(EmployeeService);
  private readonly payrollApi = inject(PayrollService);
  private readonly remunerationApi = inject(RemunerationService);
  private readonly contractApi = inject(ContractService);
  private readonly criteriaApi = inject(CriteriaService);
  private readonly rates = inject(RateService);
  private readonly api = inject(RevisionService);
  private readonly bonusApi = inject(BonusService);

  async count(office: Office): Promise<RevisionCount> {
    const thisMonth = toYearMonth(todayLocal());
    const fromMonth = revisionFromMonth(thisMonth);
    const [all, tables, criteria, bonusPayments] = await Promise.all([
      this.employeesApi.list(office.id),
      this.rates.grades(),
      this.criteriaApi.list(),
      this.bonusApi.list(office.id),
    ]);
    // 画面と同じ：出し始める月より前に辞めた人は除く
    const employees = all.filter((e) => !e.retireDate || e.retireDate >= `${fromMonth}-01`);
    // 起算月の前の月と比べるので、少し前から読む
    const months = monthsBetween(shiftMonth(fromMonth, -3), shiftMonth(thisMonth, 1));
    const payrolls = await this.payrollApi.listOfOfficeMonths(
      office.id,
      employees.map((e) => e.id),
      months,
    );
    const byEmployee = new Map<string, Payroll[]>();
    for (const p of payrolls)
      byEmployee.set(p.employeeId, [...(byEmployee.get(p.employeeId) ?? []), p]);

    const ctx = {
      office: {
        standardHours: office.standardHours ?? null,
        specificApplication: office.specificApplication,
      },
      criteria,
      schedule: payrollOf(office),
      gradeTables: tables,
      fromMonth,
    };
    const out: RevisionCount = { candidates: [], waiting: [] };
    await Promise.all(
      employees.map(async (e) => {
        const [remunerations, contracts, wageChanges] = await Promise.all([
          this.remunerationApi.list(office.id, e.id),
          this.contractApi.list(office.id, e.id),
          this.api.wageChanges(office.id, e.id),
        ]);
        const personCtx = { ...ctx, schedule: payrollAt(office, e, thisMonth) };
        const pr = personRevisions(
          {
            employee: e,
            payrolls: byEmployee.get(e.id) ?? [],
            remunerations,
            contracts,
            wageChanges,
            bonusPayments,
          },
          personCtx,
          tables,
        );
        const groups = pr.items.map(groupOf);
        if (groups.includes('candidate')) out.candidates.push(e.id);
        else if (groups.includes('waiting')) out.waiting.push(e.id);
      }),
    );
    return out;
  }
}
