import { Injectable, inject } from '@angular/core';
import { forgetAll } from '../../core/data-cache';
import type { EmployeeFull } from '../../core/models/employee';
import type { Office } from '../../core/models/office';
import { toYearMonth } from '../../shared/utils/date';
import { insurerKeyOf } from '../office/office-settings';
import { BonusService } from '../premiums/bonus.service';
import { RateService } from '../rates/rate.service';
import { ContractService } from './contract.service';
import { DependentService } from './dependent.service';
import { EmployeeService } from './employee.service';
import { planTransfer, TransferInput, TransferPlan, transferErrors, TransferError, TransferSource } from './logic/transfer';
import { RemunerationService } from './remuneration.service';

/** どこまで書けたか（途中で失敗したとき、画面で知らせる） */
export type TransferStep = 'create' | 'lists' | 'contracts' | 'remuneration' | 'dependents' | 'source';

export class TransferFailed extends Error {
  constructor(readonly step: TransferStep, readonly newEmployeeId: string | null, cause: unknown) {
    super(`transfer failed at ${step}`);
    this.cause = cause;
  }
}

/**
 * 事業所の間の異動（11/24）。何をどう写すかは logic/transfer.ts、ここは読む・書く順番だけ
 * 書く順番：①異動先に従業員を作る → ②休業など → ③契約 → ④標準報酬 → ⑤扶養家族 → ⑥最後に元の事業所で喪失
 * 元の事業所は最後に書くので、途中で失敗しても元の事業所は変わらない（異動先に途中まで作った人は、画面で知らせて登録の取り消しで消せる）
 * 異動先と元の事業所の両方の管理者でないと、ルールで止まる
 */
@Injectable({ providedIn: 'root' })
export class TransferService {
  private readonly employees = inject(EmployeeService);
  private readonly contracts = inject(ContractService);
  private readonly remunerations = inject(RemunerationService);
  private readonly dependents = inject(DependentService);
  private readonly bonuses = inject(BonusService);
  private readonly rates = inject(RateService);

  /** 異動の材料を読む（画面で、写す内容を先に見せるため） */
  async source(from: Office, to: Office, employee: EmployeeFull, date: string): Promise<TransferSource> {
    const [contracts, remunerations, dependents, bonusPayments, gradeTables] = await Promise.all([
      this.contracts.list(from.id, employee.id),
      this.remunerations.list(from.id, employee.id),
      this.dependents.list(from.id, employee.id),
      this.bonuses.list(from.id),
      this.rates.grades(),
    ]);
    const month = /^\d{4}-\d{2}-\d{2}$/.test(date) ? toYearMonth(date) : toYearMonth(new Date().toISOString().slice(0, 10));
    const strip = <T extends object>(x: T) => {
      const { createdAt: _c, updatedAt: _u, ...rest } = x as T & { createdAt?: unknown; updatedAt?: unknown };
      return rest;
    };
    return {
      employee,
      contracts: contracts.map(strip) as TransferSource['contracts'],
      remunerations,
      dependents: dependents.map((d) => {
        const { id: _id, ...rest } = strip(d) as typeof d;
        return rest;
      }) as TransferSource['dependents'],
      bonusPayments,
      fromInsurer: insurerKeyOf(from)(month),
      toInsurer: insurerKeyOf(to)(month),
      fromOfficeName: from.name,
      gradeTables,
    };
  }

  check(src: TransferSource, input: TransferInput): TransferError[] {
    return transferErrors(src, input);
  }

  plan(src: TransferSource, input: TransferInput): TransferPlan {
    return planTransfer(src, input);
  }

  /** 異動する。作った従業員の ID を返す */
  async transfer(from: Office, to: Office, employeeId: string, plan: TransferPlan): Promise<string> {
    let step: TransferStep = 'create';
    let newId: string | null = null;
    try {
      newId = await this.employees.create(to.id, plan.employee);
      step = 'lists';
      if (plan.lists.leaves.length > 0) await this.employees.updateLeaves(to.id, newId, plan.lists.leaves);
      if (plan.lists.careExemptions.length > 0) await this.employees.updateCareExemptions(to.id, newId, plan.lists.careExemptions);
      if (plan.lists.overseas.length > 0) await this.employees.updateOverseas(to.id, newId, plan.lists.overseas);
      step = 'contracts';
      for (const c of plan.contracts) await this.contracts.create(to.id, newId, c);
      step = 'remuneration';
      await this.remunerations.create(to.id, newId, plan.remuneration);
      step = 'dependents';
      for (const d of plan.dependents) await this.dependents.create(to.id, newId, d);
      step = 'source';
      await this.employees.update(from.id, employeeId, plan.source);
      return newId;
    } catch (err) {
      throw new TransferFailed(step, newId, err);
    } finally {
      // 2つの事業所の一覧・契約・標準報酬を覚えているので、全部忘れて読み直させる
      forgetAll();
    }
  }
}
