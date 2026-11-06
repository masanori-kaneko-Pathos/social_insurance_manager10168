import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
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
      this.errorKey.set('bonus.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  readonly yen = (n: number) => n.toLocaleString('ja-JP');
}
