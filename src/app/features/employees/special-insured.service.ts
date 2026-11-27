import { Injectable, inject } from '@angular/core';
import type { Employee } from '../../core/models/employee';
import type { HealthInsurer, InsurerPeriod } from '../../core/models/office';
import { insurerHistoryOf } from '../office/office-settings';
import { DependentService } from './dependent.service';
import { careDependentsIn, specialInsuredFor, usesSpecialInsured } from './logic/special-insured';
import type { Dependent } from '../../core/models/dependent';
import type { YearMonth } from '../../shared/utils/date';

/** 保険者の履歴を読める事業所（事業所の文書か、従業員向けの写し） */
export interface SpecialInsuredOffice {
  prefecture: string;
  healthInsurer: HealthInsurer;
  insurerHistory?: InsurerPeriod[];
}

export type SpecialInsuredMap = ReadonlyMap<string, (month: YearMonth) => boolean>;

/**
 * 特定被保険者（組合健保。11/26）の「月 → 特定被保険者か」を、従業員ごとに作る
 * - 事業所が特定被保険者の制度を採用している組合に入っていた期間がなければ、何も読まない（空を返す）
 * - 読むのは健康保険に入っている人の扶養家族だけ（読めなかった人は、制度なしとして計算する）
 */
@Injectable({ providedIn: 'root' })
export class SpecialInsuredService {
  private readonly dependents = inject(DependentService);

  uses(office: SpecialInsuredOffice): boolean {
    return usesSpecialInsured(insurerHistoryOf(office));
  }

  async forEmployees(officeId: string, office: SpecialInsuredOffice, employees: readonly Employee[]): Promise<SpecialInsuredMap> {
    if (!this.uses(office)) return new Map();
    const history = insurerHistoryOf(office);
    const insured = employees.filter((e) => e.health.enrolled);
    const lists = await Promise.all(insured.map((e) => this.dependents.list(officeId, e.id).catch(() => [])));
    return new Map(insured.map((e, i) => [e.id, specialInsuredFor(history, e.birthDate, lists[i])]));
  }

  /** 1人の、その月に特定被保険者の理由になっている扶養家族の氏名（特定被保険者でなければ空。11/27） */
  async reasonNames(officeId: string, office: SpecialInsuredOffice, employee: Employee, month: YearMonth): Promise<string[]> {
    if (!this.uses(office) || !employee.health.enrolled) return [];
    const list: Dependent[] = await this.dependents.list(officeId, employee.id).catch(() => []);
    if (!specialInsuredFor(insurerHistoryOf(office), employee.birthDate, list)(month)) return [];
    return careDependentsIn(list, month).map((d) => `${d.lastName} ${d.firstName}`.trim());
  }
}
