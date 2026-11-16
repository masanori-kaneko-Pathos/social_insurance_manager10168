import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { BonusPayment } from '../../../../core/models/bonus';
import { Employee } from '../../../../core/models/employee';
import { OfficeContext } from '../../../office/office-context.service';
import { everKumiai, premiumOf, ratesForOffice } from '../../../office/office-settings';
import { RateTables } from '../../../rates/logic/pick-rates';
import { RateService } from '../../../rates/rate.service';
import { BonusService } from '../../bonus.service';
import { BonusRow, buildBonusRow } from '../../logic/bonus-rows';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { fiscalYearOf, todayLocal, toYearMonth } from '../../../../shared/utils/date';
import { parseYen } from '../../../rates/logic/grade';
import { EmployeeService } from '../../../employees/employee.service';
import { HEALTH_BONUS_CAP_PER_YEAR } from '../../logic/calc-bonus';

interface CardRow extends BonusRow {
  payment: BonusPayment;
  amount: number;
}

/** 従業員の詳細に出す「賞与」（見るだけ。入力は賞与の画面で） */
@Component({
  selector: 'app-bonus-card',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './bonus-card.html',
  styleUrl: './bonus-card.css',
})
export class BonusCard implements OnInit {
  private readonly bonusApi = inject(BonusService);
  private readonly rates = inject(RateService);
  readonly context = inject(OfficeContext);

  readonly employee = input.required<Employee>();
  /** 前の事業所の分を保存したら、従業員を読み直してもらう（11/16） */
  readonly changed = output<void>();
  private readonly employeesApi = inject(EmployeeService);

  private readonly payments = signal<BonusPayment[]>([]);
  private readonly tables = signal<RateTables | null>(null);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);

  /** この人に払った賞与（新しい順） */
  readonly rows = computed<CardRow[]>(() => {
    const tables = this.tables();
    const office = this.context.current();
    if (!tables || !office) return [];
    const e = this.employee();
    const ctx = { ratesFor: ratesForOffice(office, tables), options: premiumOf(office) };
    const payments = this.payments();
    return payments
      .filter((p) => (p.amounts[e.id] ?? 0) > 0)
      .map((payment) => ({
        payment,
        amount: payment.amounts[e.id],
        ...buildBonusRow(e, payments, payment.paidDate, ctx),
      }));
  });

  ngOnInit(): void {
    this.load();
  }

  private async load(): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    try {
      const [payments, tables] = await Promise.all([
        this.bonusApi.list(office.id),
        this.rates.tablesFor(office.id, everKumiai(office)),
      ]);
      this.payments.set(payments);
      this.tables.set(tables);
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'bonus.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  // ===== 前の事業所の健保の標準賞与額（転職した人の年度累計。管理者だけ。11/16） =====
  readonly priorOpen = signal(false);
  readonly priorYear = signal(String(fiscalYearOf(toYearMonth(todayLocal()))));
  readonly priorAmount = signal('');
  readonly priorSaving = signal(false);
  readonly priorErrorKey = signal<string | null>(null);

  /** 登録済みの年度（新しい順） */
  readonly priors = computed(() =>
    Object.entries(this.employee().priorBonusTotals ?? {})
      .map(([year, amount]) => ({ year, amount }))
      .sort((a, b) => b.year.localeCompare(a.year)),
  );
  /** 入れた値が正しいか（年度は4桁、額は1,000円単位で573万円まで） */
  readonly priorValid = computed(() => {
    const amount = parseYen(this.priorAmount());
    return /^\d{4}$/.test(this.priorYear()) && amount !== null && amount > 0 && amount % 1000 === 0 && amount <= HEALTH_BONUS_CAP_PER_YEAR;
  });

  async savePrior(remove?: string): Promise<void> {
    const office = this.context.current();
    if (!office || this.priorSaving() || !this.context.isAdmin()) return;
    const next = { ...(this.employee().priorBonusTotals ?? {}) };
    if (remove) delete next[remove];
    else {
      if (!this.priorValid()) return;
      next[this.priorYear()] = parseYen(this.priorAmount())!;
    }
    this.priorSaving.set(true);
    this.priorErrorKey.set(null);
    try {
      await this.employeesApi.updatePriorBonusTotals(office.id, this.employee().id, next);
      this.priorAmount.set('');
      this.priorOpen.set(false);
      this.changed.emit();
    } catch (err) {
      console.error(err);
      this.priorErrorKey.set(errorKeyOf(err, 'bonus.prior.error'));
    } finally {
      this.priorSaving.set(false);
    }
  }

  readonly yen = (n: number) => n.toLocaleString('ja-JP');
}
