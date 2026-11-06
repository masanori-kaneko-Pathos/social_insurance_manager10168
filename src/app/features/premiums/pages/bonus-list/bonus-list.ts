import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { BonusPayment } from '../../../../core/models/bonus';
import { Employee } from '../../../../core/models/employee';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import { everKumiai, premiumOf, ratesForOffice } from '../../../office/office-settings';
import { RateTables } from '../../../rates/logic/pick-rates';
import { RateService } from '../../../rates/rate.service';
import { BonusService } from '../../bonus.service';
import { collectBonusResults } from '../../logic/bonus-rows';
import { officeTotals } from '../../logic/premium-core';

interface ListRow {
  payment: BonusPayment;
  people: number;
  totalYen: number; // 納付額（健保・厚年・拠出金の合計）
  problems: number;
}

@Component({
  selector: 'app-bonus-list',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './bonus-list.html',
  styleUrl: './bonus-list.css',
})
export class BonusList {
  private readonly employeesApi = inject(EmployeeService);
  private readonly bonusApi = inject(BonusService);
  private readonly rates = inject(RateService);
  readonly context = inject(OfficeContext);

  private readonly employees = signal<Employee[]>([]);
  private readonly payments = signal<BonusPayment[]>([]);
  private readonly tables = signal<RateTables | null>(null);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);

  /** 1回の支給を1行に（新しい順） */
  readonly rows = computed<ListRow[]>(() => {
    const tables = this.tables();
    const office = this.context.current();
    if (!tables || !office) return [];
    const ctx = { ratesFor: ratesForOffice(office, tables), options: premiumOf(office) };
    const payments = this.payments();
    return payments.map((payment) => {
      const c = collectBonusResults(
        this.employees(),
        payments,
        ctx,
        (d) => d === payment.paidDate,
      );
      return {
        payment,
        people: Object.values(payment.amounts).filter((n) => n > 0).length,
        totalYen: officeTotals(c.results).reduce((s, t) => s + t.totalYen, 0),
        problems: c.problemCount,
      };
    });
  });

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    try {
      const [employees, payments, tables] = await Promise.all([
        this.employeesApi.list(office.id),
        this.bonusApi.list(office.id),
        this.rates.tablesFor(office.id, everKumiai(office)),
      ]);
      this.employees.set(employees);
      this.payments.set(payments);
      this.tables.set(tables);
    } catch (err) {
      console.error(err);
      this.errorKey.set('bonus.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  readonly yen = (n: number) => n.toLocaleString('ja-JP');
}
