/**
 * 並行稼働の検算（11/24）
 * 取り込みの CSV を、画面と同じ計算の部品に順に流し、人 × 月の保険料・賞与・事業所の納付額を出す。
 * 保存の代わりに配列に積むだけで、順番は実務と同じ：
 *   従業員 → 標準報酬の履歴 → 給与の実績 → 賞与
 *   → 随時改定（改定月が定時決定の年の9月まで）→ 定時決定 → 随時改定（10月から）→ 保険料
 * 「こうなるはず」はアプリとは別に計算した値（seed/test-data/…/gen.py）と比べる（parallel-run.spec.ts）。
 * Angular・Firebase に依存しない純粋な関数
 */
import { BonusPayment } from '../core/models/bonus';
import { ContractDoc } from '../core/models/contract';
import { Employee, employeeExtras } from '../core/models/employee';
import { CriteriaDoc } from '../core/models/master';
import { OfficeTotal, PremiumResult } from '../core/models/premium';
import { GradeTableDoc, MasterRateDoc } from '../core/models/rates';
import { RemunerationDoc, RemunerationInput } from '../core/models/remuneration';
import { Payroll } from '../core/models/payroll';
import { readEmployeeCsv, planImport } from '../features/employees/logic/employee-csv';
import { planHistoryImport, readHistoryCsv } from '../features/employees/logic/history-csv';
import { insurerKeyOf, payrollOf, premiumOf, ratesForOffice } from '../features/office/office-settings';
import { readPayrollCsv } from '../features/payrolls/logic/payroll-csv';
import { buildRegularView, canReflectRegular, regularReflectItem, regularTargets } from '../features/payrolls/logic/regular-views';
import { personRevisions, revisionRemuneration } from '../features/payrolls/logic/revision-reflect';
import { groupOf, RevisionContext, revisionFromMonth } from '../features/payrolls/logic/revision-rows';
import { bonusWrites, planBonusImport } from '../features/premiums/logic/bonus-csv';
import { collectBonusResults } from '../features/premiums/logic/bonus-rows';
import { officeTotals } from '../features/premiums/logic/premium-core';
import { buildPremiumRow } from '../features/premiums/logic/premium-rows';
import { pickGradeTable } from '../features/rates/logic/grade';
import { parseCsv } from '../shared/csv/csv';
import { monthsBetween, YearMonth } from '../shared/utils/date';

/** 検算に使う事業所（画面の事業所の設定と同じ項目。保存しないので Office の一部だけ） */
export type RunOffice = Parameters<typeof payrollOf>[0] & {
  id: string;
  standardHours: { weeklyMinutes: number; monthlyDays: number } | null;
  specificApplication: { since: string | null; voluntary: boolean; insuredCount: number | null };
  departments?: { id: string; name: string }[];
};

export interface ParallelRunInput {
  office: RunOffice;
  master: MasterRateDoc[];
  gradeTables: GradeTableDoc[];
  criteria: CriteriaDoc[];
  csv: { employees: string; remunerationHistory?: string; payrolls: string; bonuses?: string };
  /** 定時決定の年 */
  regularYear: number;
  /** 保険料を出す月（何月分） */
  months: YearMonth[];
  /**
   * 随時改定で「向きは要確認」（固定的賃金が上がって時間外手当が0円になった）の候補を反映する人の社員番号。
   * 担当者が確かめて決めるものなので、書いていない人は反映しない（たまたま0円だった、の扱い。事例集 4 問4）
   */
  reflectUnclear?: readonly string[];
}

export interface MonthLine {
  state: string;
  /** 健保・介護・支援金の本人負担（端数処理の単位の合計） */
  healthYen: number | null;
  pensionYen: number | null;
  healthStd: number | null;
  pensionStd: number | null;
  care: boolean;
}

export interface BonusLine {
  employeeNumber: string;
  paidDate: string;
  healthYen: number | null;
  pensionYen: number | null;
  healthBase: number;
  pensionBase: number;
}

export interface ParallelRunResult {
  /** 取り込みで止まった行など（空であること） */
  problems: string[];
  /** 社員番号 → 標準報酬の履歴（開始月・理由・報酬月額） */
  decisions: Map<string, { from: string; reason: string; monthlyAmount: number }[]>;
  /** 社員番号 → 何月分 → 1か月の結果 */
  months: Map<string, Map<YearMonth, MonthLine>>;
  bonuses: BonusLine[];
  /** 何月分 → 事業所の合計（月額＋その月の賞与。告知額にあたる） */
  totals: Map<YearMonth, OfficeTotal[]>;
}

const table = (text: string) => parseCsv(text.replace(/^﻿/, ''));

const yenOf = (r: PremiumResult | null | undefined, part: 'health' | 'pension'): number | null => {
  const g = r?.groups.find((x) => x.parts.includes(part));
  return g ? g.employeeYen : null;
};

export function runParallel(input: ParallelRunInput): ParallelRunResult {
  const { office, gradeTables, criteria } = input;
  const problems: string[] = [];
  const schedule = payrollOf(office);
  const options = premiumOf(office);
  const rateTables = { master: input.master, kumiai: [] };

  // ===== 1. 従業員（画面：従業員の取り込み） =====
  const read = readEmployeeCsv(table(input.csv.employees));
  if (read.missingColumns.length) problems.push(`employees: missing ${read.missingColumns.join(',')}`);
  for (const r of read.rows) if (r.errors.length) problems.push(`employees line ${r.line}: ${JSON.stringify(r.errors)}`);
  const plan = planImport(read.rows, {
    office: { standardHours: office.standardHours, specificApplication: office.specificApplication },
    criteria,
    gradeTables,
    existingNumbers: new Set(),
    existingPeople: new Map(),
    departments: office.departments ?? [],
  });
  for (const e of plan.errors) problems.push(`employees line ${e.line}: ${e.code}`);

  const employees: Employee[] = [];
  const contracts = new Map<string, ContractDoc[]>();
  const rems = new Map<string, RemunerationDoc[]>();
  for (const it of plan.items) {
    const id = it.employee.employeeNumber ?? `L${it.line}`;
    employees.push({ ...employeeExtras(), ...it.employee, leaves: it.leaves, id } as unknown as Employee);
    contracts.set(id, [it.contract as unknown as ContractDoc]);
    rems.set(id, it.remuneration ? [it.remuneration as unknown as RemunerationDoc] : []);
  }
  const putRem = (id: string, r: RemunerationInput) => {
    const list = (rems.get(id) ?? []).filter((x) => x.from !== r.from);
    rems.set(id, [...list, r as unknown as RemunerationDoc].sort((a, b) => a.from.localeCompare(b.from)));
  };

  // ===== 2. 標準報酬の履歴（画面：履歴の取り込み） =====
  if (input.csv.remunerationHistory) {
    const h = readHistoryCsv('remuneration', table(input.csv.remunerationHistory));
    if (h.missingColumns.length) problems.push(`history: missing ${h.missingColumns.join(',')}`);
    const existing = new Map(employees.map((e) => [e.id, new Set((rems.get(e.id) ?? []).map((r) => r.from))]));
    const hp = planHistoryImport(h.rows, {
      employees: employees.map((e) => ({ ...e, retireDate: e.retireDate ?? null })),
      existing,
      gradeTables,
    });
    for (const e of hp.errors) problems.push(`history line ${e.line}: ${e.code}`);
    for (const it of hp.items) if (it.remuneration) putRem(it.employeeId, it.remuneration);
  }

  // ===== 3. 給与の実績（画面：給与の取り込み） =====
  const pr = readPayrollCsv(table(input.csv.payrolls), employees.map((e) => ({ ...e, employeeNumber: e.employeeNumber ?? null })), schedule);
  if (pr.missingColumns.length) problems.push(`payrolls: missing ${pr.missingColumns.join(',')}`);
  for (const e of pr.errors) problems.push(`payrolls line ${e.line}: ${e.codes.join(',')}`);
  const payrolls = new Map<string, Payroll[]>();
  for (const it of pr.items) {
    const p: Payroll = { ...it.input, officeId: office.id, employeeId: it.employeeId, paidMonth: it.paidMonth };
    payrolls.set(it.employeeId, [...(payrolls.get(it.employeeId) ?? []), p]);
  }

  // ===== 4. 賞与（画面：賞与の取り込み） =====
  const payments: BonusPayment[] = [];
  if (input.csv.bonuses) {
    const targets = employees.map((e) => ({
      id: e.id,
      employeeNumber: e.employeeNumber ?? null,
      lastName: e.lastName,
      firstName: e.firstName,
      hireDate: e.hireDate,
      retireDate: e.retireDate ?? null,
    }));
    const bp = planBonusImport(table(input.csv.bonuses), targets, []);
    for (const r of bp.rows) if (r.status === 'error') problems.push(`bonuses line ${r.line}: ${JSON.stringify(r.errors)}`);
    bonusWrites(bp.rows.filter((r) => r.status !== 'error'), []).forEach((w, i) =>
      payments.push({ ...w.input, id: `B${i + 1}` } as unknown as BonusPayment),
    );
  }

  // ===== 5. 随時改定・定時決定（候補は担当者が全部反映した、とみなす） =====
  const last = input.months[input.months.length - 1];
  const revisionCtx: RevisionContext = {
    office: { standardHours: office.standardHours, specificApplication: office.specificApplication },
    criteria,
    schedule,
    gradeTables,
    fromMonth: revisionFromMonth(last),
  };
  const reflectRevisions = (accept: (revisedFrom: string) => boolean) => {
    for (const e of employees) {
      // 1回に1件（いちばん早い改定月）ずつ反映し、候補がなくなるまで見直す（反映すると次の候補が変わるため）
      for (let guard = 0; guard < 24; guard++) {
        const p = personRevisions(
          { employee: e, payrolls: payrolls.get(e.id) ?? [], remunerations: rems.get(e.id) ?? [], contracts: contracts.get(e.id) ?? [], wageChanges: [], bonusPayments: payments },
          revisionCtx,
          gradeTables,
        );
        const next = p.items
          .filter((i) => groupOf(i) === 'candidate' && accept(i.result.revisedFrom))
          .filter((i) => i.type !== 'irregular' || i.result.start.direction !== 'unclear' || unclearOk.has(e.employeeNumber ?? ''))
          .sort((a, b) => a.result.revisedFrom.localeCompare(b.result.revisedFrom))[0];
        if (!next) break;
        putRem(e.id, revisionRemuneration(next, p.remunerations, false));
      }
    }
  };
  const unclearOk = new Set(input.reflectUnclear ?? []);
  const y = input.regularYear;
  reflectRevisions((m) => m <= `${y}-09`);

  const health = pickGradeTable(gradeTables, 'health', `${y}-09`);
  const pension = pickGradeTable(gradeTables, 'pension', `${y}-09`);
  if (!health || !pension) problems.push('regular: no grade table');
  else {
    const grades = { health: health.grades, pension: pension.grades };
    const regularCtx: RevisionContext = { ...revisionCtx, fromMonth: `${y}-01` };
    for (const employee of regularTargets(employees, y)) {
      const own = new Map((payrolls.get(employee.id) ?? []).map((p): [string, Payroll] => [p.paidMonth, p]));
      const v = buildRegularView({
        year: y,
        employee,
        payrolls: own,
        remunerations: rems.get(employee.id) ?? [],
        contracts: contracts.get(employee.id) ?? [],
        decision: null,
        bonusPayments: payments,
        grades,
        revisionCtx: regularCtx,
      });
      if (!canReflectRegular(v)) continue;
      const item = regularReflectItem(v, v.result.status === 'keep' ? 'keep' : 'normal', y, office.id, grades.pension);
      putRem(employee.id, item.remuneration);
    }
  }
  reflectRevisions((m) => m > `${y}-09`);

  const decisions = new Map(
    employees.map((e) => [
      e.employeeNumber ?? e.id,
      (rems.get(e.id) ?? []).map((r) => ({ from: r.from, reason: r.reason, monthlyAmount: r.monthlyAmount })),
    ]),
  );

  // ===== 6. 保険料（画面：保険料一覧）・賞与・事業所の合計 =====
  const ratesFor = ratesForOffice(office, rateTables);
  const months = new Map<string, Map<YearMonth, MonthLine>>();
  const totals = new Map<YearMonth, OfficeTotal[]>();
  const bonuses: BonusLine[] = [];
  const numberOf = new Map(employees.map((e) => [e.id, e.employeeNumber ?? e.id]));
  for (const month of input.months) {
    const ok: PremiumResult[] = [];
    for (const employee of employees) {
      const row = buildPremiumRow({ month, employee, remunerations: rems.get(employee.id) ?? [], ratesFor, options });
      if (row.state === 'missing' || row.state === 'error') problems.push(`premium ${month} ${employee.employeeNumber}: ${row.state}`);
      if (row.state === 'ok' && row.result) ok.push(row.result);
      const line: MonthLine = {
        state: row.state,
        healthYen: yenOf(row.result, 'health'),
        pensionYen: yenOf(row.result, 'pension'),
        healthStd: row.result?.groups.flatMap((g) => g.lines).find((l) => l.part === 'health')?.base ?? null,
        pensionStd: row.result?.groups.flatMap((g) => g.lines).find((l) => l.part === 'pension')?.base ?? null,
        care: !!row.result?.groups.some((g) => g.parts.includes('care')),
      };
      const no = numberOf.get(employee.id)!;
      if (!months.has(no)) months.set(no, new Map());
      months.get(no)!.set(month, line);
    }
    const c = collectBonusResults(
      employees,
      payments,
      { ratesFor, insurerOf: insurerKeyOf(office), options },
      (d) => d.startsWith(month),
    );
    if (c.problemCount > 0) problems.push(`bonus ${month}: ${c.problemCount} not calculated`);
    totals.set(month, officeTotals([...ok, ...c.results]));
  }

  // 賞与の1人ずつ（支払日ごと）
  const paidMonths = [...new Set(payments.map((p) => p.paidDate.slice(0, 7)))];
  for (const e of employees) {
    for (const m of paidMonths) {
      const c = collectBonusResults([e], payments, { ratesFor, insurerOf: insurerKeyOf(office), options }, (d) => d.startsWith(m));
      for (const r of c.results) {
        bonuses.push({
          employeeNumber: e.employeeNumber ?? e.id,
          paidDate: r.paidDate,
          healthYen: yenOf(r, 'health'),
          pensionYen: yenOf(r, 'pension'),
          healthBase: r.healthBase,
          pensionBase: r.pensionBase,
        });
      }
    }
  }

  return { problems, decisions, months, bonuses, totals };
}

/** 'YYYY-MM' から 'YYYY-MM' まで */
export const monthsOf = (from: YearMonth, to: YearMonth) => monthsBetween(from, to);
