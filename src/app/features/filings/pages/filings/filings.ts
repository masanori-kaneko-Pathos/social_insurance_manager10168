import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { Payroll } from '../../../../core/models/payroll';
import { downloadCsv, safeFileName } from '../../../../shared/csv/csv';
import { MonthPicker } from '../../../../shared/components/month-picker/month-picker';
import { daysInMonth, shiftMonth, todayLocal, toYearMonth, YearMonth } from '../../../../shared/utils/date';
import { ContractService } from '../../../employees/contract.service';
import { DependentService } from '../../../employees/dependent.service';
import { EmployeeService } from '../../../employees/employee.service';
import { classify } from '../../../employees/logic/classify';
import { contractAt } from '../../../employees/logic/contract-form-model';
import { RemunerationService } from '../../../employees/remuneration.service';
import { CriteriaService } from '../../../office/criteria.service';
import { OfficeContext } from '../../../office/office-context.service';
import { payrollOf } from '../../../office/office-settings';
import { findStartMonths } from '../../../payrolls/logic/irregular';
import { latestPaidMonth } from '../../../payrolls/logic/payroll-rows';
import { regularYearOf } from '../../../payrolls/logic/regular';
import { standardAt } from '../../../payrolls/logic/revision-base';
import { PayrollService } from '../../../payrolls/payroll.service';
import { RegularService } from '../../../payrolls/regular.service';
import { RevisionService } from '../../../payrolls/revision.service';
import { BonusService } from '../../../premiums/bonus.service';
import { eligibleOn } from '../../../premiums/logic/bonus-rows';
import {
  acquiredDateOf,
  acquireRow,
  bonusRow,
  FILING_COLUMNS,
  FILING_KINDS,
  filingFileName,
  FilingKind,
  FilingRow,
  firstPaidInMonth,
  irregularRemarks,
  lossesIn,
  lossRow,
  regularRemarks,
  revisionRow,
  toCells,
} from '../../logic/filing-rows';

/**
 * 届書の一覧：様式と期間を選んで「表示」→ 表で確かめて CSV に書き出す
 * 読み込みは「表示」を押したときだけ（画面を開いただけでは読まない）
 * 「届を出した」の記録は持たない（書き出した CSV を控えにする）
 */
@Component({
  selector: 'app-filings',
  imports: [MonthPicker, RouterLink, TranslocoPipe],
  templateUrl: './filings.html',
  styleUrl: './filings.css',
})
export class FilingsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  private readonly employeesApi = inject(EmployeeService);
  private readonly contractsApi = inject(ContractService);
  private readonly dependentsApi = inject(DependentService);
  private readonly remunerationsApi = inject(RemunerationService);
  private readonly criteriaApi = inject(CriteriaService);
  private readonly payrollApi = inject(PayrollService);
  private readonly regularApi = inject(RegularService);
  private readonly revisionApi = inject(RevisionService);
  private readonly bonusApi = inject(BonusService);
  readonly context = inject(OfficeContext);

  readonly kinds = FILING_KINDS;
  readonly today = todayLocal();
  readonly thisMonth = toYearMonth(this.today);

  private readonly q = this.route.snapshot.queryParamMap;
  readonly kind = signal<FilingKind>((FILING_KINDS as readonly string[]).includes(this.q.get('kind') ?? '') ? (this.q.get('kind') as FilingKind) : 'acquire');
  readonly from = signal<YearMonth>(this.monthParam('from') ?? this.thisMonth);
  readonly to = signal<YearMonth>(this.monthParam('to') ?? this.monthParam('from') ?? this.thisMonth);
  readonly year = signal<number>(this.defaultYear());

  readonly loading = signal(false);
  readonly errorKey = signal<string | null>(null);
  /** 表示した結果（様式・期間・行）。条件を変えたら消す */
  readonly result = signal<{ kind: FilingKind; period: string; rows: FilingRow[] } | null>(null);
  readonly columns = computed(() => {
    const r = this.result();
    return r ? FILING_COLUMNS[r.kind] : [];
  });

  private employees: Employee[] | null = null;

  private monthParam(key: string): YearMonth | null {
    const v = this.q.get(key);
    return v && /^\d{4}-\d{2}$/.test(v) ? v : null;
  }

  private defaultYear(): number {
    const office = this.context.current();
    return office ? regularYearOf(latestPaidMonth(this.today, payrollOf(office))) : Number(this.today.slice(0, 4));
  }

  setKind(k: string): void {
    this.kind.set(k as FilingKind);
    this.result.set(null);
  }

  setFrom(m: YearMonth): void {
    this.from.set(m);
    if (this.to() < m) this.to.set(m);
    this.result.set(null);
  }

  setTo(m: YearMonth): void {
    this.to.set(m);
    if (this.from() > m) this.from.set(m);
    this.result.set(null);
  }

  setYear(diff: number): void {
    this.year.update((y) => y + diff);
    this.result.set(null);
  }

  // ===== 表示 =====

  async show(): Promise<void> {
    const office = this.context.current();
    if (!office || this.loading()) return;
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      this.employees ??= await this.employeesApi.list(office.id);
      const kind = this.kind();
      const fromDate = `${this.from()}-01`;
      const toDate = `${this.to()}-${String(daysInMonth(this.to())).padStart(2, '0')}`;
      let rows: FilingRow[] = [];
      switch (kind) {
        case 'acquire':
          rows = await this.acquireRows(office.id, fromDate, toDate);
          break;
        case 'loss':
          rows = this.employees.flatMap((e) => lossesIn(e, fromDate, toDate).map((l) => lossRow(e, l)));
          break;
        case 'regular':
          rows = await this.regularRows(office.id, this.year());
          break;
        case 'irregular':
          rows = await this.irregularRows(office.id);
          break;
        case 'bonus':
          rows = await this.bonusRows(office.id, fromDate, toDate);
          break;
      }
      rows.sort((a, b) => (a['dateIso'] ?? '').localeCompare(b['dateIso'] ?? '') || (a['insuredNumber'] ?? '').localeCompare(b['insuredNumber'] ?? '', 'ja', { numeric: true }));
      this.result.set({ kind, period: this.periodText(), rows });
    } catch (err) {
      console.error(err);
      this.errorKey.set('filing.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  periodText(): string {
    if (this.kind() === 'regular') return String(this.year());
    return this.from() === this.to() ? this.from() : `${this.from()}_${this.to()}`;
  }

  /** 取得届：取得日が期間内の人。契約（報酬月額の見込み・区分）と扶養家族を、その人の分だけ読む */
  private async acquireRows(officeId: string, from: string, to: string): Promise<FilingRow[]> {
    const office = this.context.current()!;
    const targets = this.employees!.filter((e) => {
      const d = acquiredDateOf(e);
      return !!d && d >= from && d <= to;
    });
    if (targets.length === 0) return [];
    const criteria = await this.criteriaApi.list();
    const rows = await Promise.all(
      targets.map(async (e) => {
        const [contracts, dependents] = await Promise.all([
          this.contractsApi.list(officeId, e.id),
          this.dependentsApi.list(officeId, e.id).catch(() => null),
        ]);
        const date = acquiredDateOf(e)!;
        const c = contractAt(contracts, date);
        const category = classify(
          { birthDate: e.birthDate, optInDate: e.optInDate, optOutDate: e.optOutDate ?? null, contracts },
          { standardHours: office.standardHours ?? null, specificApplication: office.specificApplication },
          criteria,
          date,
        ).category;
        return acquireRow({
          employee: e,
          pensionFund: office.pensionFund,
          expected: c ? { cash: c.expectedCash, inKind: c.expectedInKind } : null,
          hasDependents: dependents === null ? null : dependents.length > 0,
          shortTime: category === 'shortTime',
        });
      }),
    );
    return rows.filter((r): r is FilingRow => r !== null);
  }

  /** 算定基礎届：その年の定時決定の記録がある人。3〜6月の実績（昇降給の比べ先に3月も）と標準報酬を読む */
  private async regularRows(officeId: string, year: number): Promise<FilingRow[]> {
    const ids = this.employees!.map((e) => e.id);
    const decisions = await this.regularApi.decisions(officeId, ids, year);
    const targets = this.employees!.filter((e) => decisions.has(e.id) && decisions.get(e.id)!.method !== 'keep');
    if (targets.length === 0) return [];
    const tIds = targets.map((e) => e.id);
    const months = ['03', '04', '05', '06'].map((m) => `${year}-${m}`);
    const [byMonth, rems] = await Promise.all([
      Promise.all(months.map((m) => this.payrollApi.month(officeId, tIds, m))),
      Promise.all(tIds.map((id) => this.remunerationsApi.list(officeId, id))),
    ]);
    return targets.map((e, i) => {
      const d = decisions.get(e.id)!;
      const payrolls = new Map<string, Payroll>();
      months.forEach((m, k) => {
        const p = byMonth[k].get(e.id);
        if (p) payrolls.set(m, p);
      });
      const prev = standardAt(rems[i], `${year}-08`);
      const raise = findStartMonths(payrolls).find((s) => s.month >= `${year}-04` && s.direction !== 'unclear');
      return revisionRow('regular', {
        employee: e,
        month: `${year}-09`,
        firstMonth: `${year}-04`,
        payrolls,
        previous: prev ? { health: prev.health.standard, pension: prev.pension.standard, from: prev.from } : null,
        raise: raise ? { month: raise.month, direction: raise.direction as 'up' | 'down' } : null,
        total: d.total,
        average: d.average,
        corrected: d.corrected,
        remarks: regularRemarks({ employee: e, year, annual: d.method === 'annual', payrolls }),
      });
    });
  }

  /** 月額変更届：改定月が期間内の随時改定の記録。3か月の実績と標準報酬を、その人の分だけ読む */
  private async irregularRows(officeId: string): Promise<FilingRow[]> {
    const all = await this.revisionApi.irregularDecisions(officeId, this.employees!.map((e) => e.id));
    const decisions = all.filter((d) => d.revisedFrom >= this.from() && d.revisedFrom <= this.to());
    const byId = new Map(this.employees!.map((e) => [e.id, e]));
    return Promise.all(
      decisions
        .filter((d) => byId.has(d.employeeId))
        .map(async (d) => {
          const e = byId.get(d.employeeId)!;
          const months = [0, 1, 2].map((i) => shiftMonth(d.startMonth, i));
          const [maps, rems] = await Promise.all([
            Promise.all(months.map((m) => this.payrollApi.month(officeId, [e.id], m))),
            this.remunerationsApi.list(officeId, e.id),
          ]);
          const payrolls = new Map<string, Payroll>();
          months.forEach((m, k) => {
            const p = maps[k].get(e.id);
            if (p) payrolls.set(m, p);
          });
          const prev = standardAt(rems, shiftMonth(d.revisedFrom, -1));
          return revisionRow('irregular', {
            employee: e,
            month: d.revisedFrom,
            firstMonth: d.startMonth,
            payrolls,
            previous: prev ? { health: prev.health.standard, pension: prev.pension.standard, from: prev.from } : null,
            raise: { month: d.startMonth, direction: d.direction },
            total: d.total,
            average: d.average,
            corrected: d.corrected,
            remarks: irregularRemarks({
              employee: e,
              revisedFrom: d.revisedFrom,
              annual: d.method === 'annual',
              reasonNote: d.reasonNote,
            }),
          });
        }),
    );
  }

  /** 賞与支払届：支払日が期間内の支給。支払日に資格がある人だけ（1回の問い合わせ） */
  private async bonusRows(officeId: string, from: string, to: string): Promise<FilingRow[]> {
    const payments = await this.bonusApi.list(officeId);
    const byId = new Map(this.employees!.map((e) => [e.id, e]));
    return payments
      .filter((p) => p.paidDate >= from && p.paidDate <= to)
      .flatMap((p) =>
        Object.entries(p.amounts)
          .filter(([id, amount]) => amount > 0 && byId.has(id) && eligibleOn(byId.get(id)!, p.paidDate))
          .map(([id, amount]) =>
            bonusRow({
              employee: byId.get(id)!,
              paidDate: p.paidDate,
              cash: amount,
              inKind: p.inKindAmounts?.[id] ?? 0,
              firstPaidInMonth: firstPaidInMonth(id, p.paidDate, payments),
            }),
          ),
      );
  }

  // ===== 書き出し =====

  exportCsv(): void {
    const r = this.result();
    if (!r) return;
    const t = (k: string) => this.transloco.translate(k);
    const header = FILING_COLUMNS[r.kind].map((c) => t(`filing.col.${c}`));
    const lines = r.rows.map((row) => toCells(r.kind, row));
    downloadCsv(safeFileName(filingFileName(t(`filing.kind.${r.kind}`), r.period, this.today)), [header, ...lines]);
  }
}
