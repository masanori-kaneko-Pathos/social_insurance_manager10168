import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { BonusPayment } from '../../../../core/models/bonus';
import { ContractDoc } from '../../../../core/models/contract';
import { CriteriaDoc } from '../../../../core/models/master';
import { Office } from '../../../../core/models/office';
import { RemunerationDoc } from '../../../../core/models/remuneration';
import { downloadCsv, safeFileName } from '../../../../shared/csv/csv';
import { todayLocal, toYearMonth, shiftMonth, YearMonth } from '../../../../shared/utils/date';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { ContractService } from '../../../employees/contract.service';
import { EmployeeService } from '../../../employees/employee.service';
import { RemunerationService } from '../../../employees/remuneration.service';
import { CriteriaService } from '../../../office/criteria.service';
import { OfficeContext } from '../../../office/office-context.service';
import { everKumiai, insurerKeyOf, premiumOf, ratesForOffice } from '../../../office/office-settings';
import { withCapRevisions } from '../../../rates/logic/cap-revision';
import { RateTables } from '../../../rates/logic/pick-rates';
import { RateService } from '../../../rates/rate.service';
import { BonusService } from '../../bonus.service';
import { AdjustmentOffice, adjustmentForEmployee } from '../../logic/adjustment-office';
import {
  fiscalStart,
  monthsOfPeriod,
  periodMonth,
  PeriodMonth,
  sumPeriod,
  TOTAL_CATEGORIES,
  TotalCategory,
} from '../../logic/period-totals';
import { BackLink } from '../../../../shared/components/back-link/back-link';

/**
 * 期間ごとの会社負担の集計（11/24）
 * 月ごとに、納付書の行（健康保険・厚生年金・拠出金）の会社負担を並べて期間で合計する。決算の未払金・人件費に使う。
 * 計算は保険料の一覧と同じ（月額と賞与を足して切り捨てた納付額 − 本人負担）。CSV で出せる
 */
@Component({
  selector: 'app-premium-period',
  imports: [BackLink, RouterLink, TranslocoPipe],
  templateUrl: './premium-period.html',
  styleUrl: './premium-period.css',
})
export class PremiumPeriod {
  readonly context = inject(OfficeContext);
  private readonly employeesApi = inject(EmployeeService);
  private readonly remApi = inject(RemunerationService);
  private readonly rates = inject(RateService);
  private readonly bonusApi = inject(BonusService);
  private readonly contractApi = inject(ContractService);
  private readonly criteriaApi = inject(CriteriaService);
  private readonly transloco = inject(TranslocoService);

  readonly categories = TOTAL_CATEGORIES;
  readonly thisMonth = toYearMonth(todayLocal());
  readonly from = signal<YearMonth>(fiscalStart(this.thisMonth));
  readonly to = signal<YearMonth>(this.thisMonth);
  readonly months = computed(() => monthsOfPeriod(this.from(), this.to()));

  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);
  private readonly employees = signal<Employee[]>([]);
  private readonly remunerations = signal<Map<string, RemunerationDoc[]>>(new Map());
  private readonly tables = signal<RateTables | null>(null);
  private readonly payments = signal<BonusPayment[]>([]);
  private readonly contracts = signal<Map<string, ContractDoc[]>>(new Map());
  private readonly criteria = signal<CriteriaDoc[]>([]);

  constructor() {
    effect(() => {
      const office = this.context.current();
      if (office) untracked(() => void this.load(office));
    });
  }

  private async load(office: Office): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const [employees, tables, payments, gradeTables] = await Promise.all([
        this.employeesApi.list(office.id),
        this.rates.tablesFor(office.id, everKumiai(office)),
        this.bonusApi.list(office.id),
        this.rates.grades(),
      ]);
      const lists = await Promise.all(employees.map((e) => this.remApi.list(office.id, e.id)));
      this.remunerations.set(new Map(employees.map((e, i) => [e.id, withCapRevisions(lists[i], gradeTables)])));
      // 保険料調整制度を使っている事業所は、保険料の一覧と同じく軽減を入れる
      if (office.premiumAdjustment?.since) {
        const [contracts, criteria] = await Promise.all([
          Promise.all(employees.map((e) => this.contractApi.list(office.id, e.id))),
          this.criteriaApi.list(),
        ]);
        this.contracts.set(new Map(employees.map((e, i) => [e.id, contracts[i]])));
        this.criteria.set(criteria);
      }
      this.employees.set(employees);
      this.tables.set(tables);
      this.payments.set(payments);
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'premiumPeriod.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  /** 月ごとの行（期間・データが変わると計算し直す） */
  readonly rows = computed<PeriodMonth[]>(() => {
    const office = this.context.current();
    const tables = this.tables();
    const months = this.months();
    if (!office || !tables || !months) return [];
    const options = premiumOf(office);
    const ratesFor = ratesForOffice(office, tables);
    const ao: AdjustmentOffice | null = office.premiumAdjustment?.since
      ? { ...office, since: office.premiumAdjustment.since, standardHours: office.standardHours ?? null }
      : null;
    const input = {
      employees: this.employees(),
      rowInputOf: (e: Employee) => ({
        remunerations: this.remunerations().get(e.id) ?? [],
        ratesFor,
        options,
        adjustmentFor: ao
          ? adjustmentForEmployee(ao, e, this.contracts().get(e.id) ?? [], this.criteria(), this.remunerations().get(e.id) ?? [])
          : undefined,
      }),
      payments: this.payments(),
      bonusCtx: { ratesFor, insurerOf: insurerKeyOf(office), options },
    };
    return months.map((m) => periodMonth(m, input));
  });
  readonly sum = computed(() => sumPeriod(this.rows()));
  readonly problems = computed(() => this.rows().filter((r) => r.problems > 0).length);

  setFrom(v: string): void {
    if (/^\d{4}-\d{2}$/.test(v)) this.from.set(v);
  }
  setTo(v: string): void {
    if (/^\d{4}-\d{2}$/.test(v)) this.to.set(v);
  }
  /** 今年度・前年度（4月〜3月。今年度は今月まで） */
  thisYear(): void {
    this.from.set(fiscalStart(this.thisMonth));
    this.to.set(this.thisMonth);
  }
  lastYear(): void {
    const start = shiftMonth(fiscalStart(this.thisMonth), -12);
    this.from.set(start);
    this.to.set(shiftMonth(start, 11));
  }

  yen(n: number): string {
    return n.toLocaleString('ja-JP');
  }
  monthLabel(m: string): string {
    return this.transloco.translate('premiumPeriod.monthLabel', { y: m.slice(0, 4), m: Number(m.slice(5)) });
  }

  exportCsv(): void {
    const office = this.context.current();
    if (!office) return;
    const t = (k: string) => this.transloco.translate(k);
    const cat = (c: TotalCategory) => t('premiumPeriod.col.' + c);
    const header = [t('premiumPeriod.col.month'), ...this.categories.map(cat), t('premiumPeriod.col.employer'), t('premiumPeriod.col.employee'), t('premiumPeriod.col.payment'), t('premiumPeriod.col.bonus')];
    const line = (label: string, r: Omit<PeriodMonth, 'month' | 'hasBonus'>, bonus: string) => [
      label,
      ...this.categories.map((c) => String(r.employer[c])),
      String(r.employerTotal),
      String(r.employeeTotal),
      String(r.paymentTotal),
      bonus,
    ];
    const rows = [
      header,
      ...this.rows().map((r) => line(r.month, r, r.hasBonus ? '1' : '')),
      line(t('premiumPeriod.total'), this.sum(), ''),
    ];
    const name = `${t('premiumPeriod.fileTitle')}_${office.name}_${this.from()}〜${this.to()}_${todayLocal().replace(/-/g, '')}.csv`;
    downloadCsv(safeFileName(name), rows);
  }
}
