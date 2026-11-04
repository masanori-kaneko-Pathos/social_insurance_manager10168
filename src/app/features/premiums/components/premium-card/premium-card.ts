import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import {
  DEFAULT_PREMIUM_OPTIONS,
  PremiumGroup,
  PremiumLine,
  PremiumResult,
} from '../../../../core/models/premium';
import { RemunerationDoc } from '../../../../core/models/remuneration';
import { todayLocal } from '../../../../shared/utils/date';
import { toYearMonth, YearMonth } from '../../../employees/logic/coverage';
import { RemunerationService } from '../../../employees/remuneration.service';
import { OfficeContext } from '../../../office/office-context.service';
import { pickRates, RateTables } from '../../../rates/logic/pick-rates';
import { formatPercent } from '../../../rates/logic/rate-format';
import { RateService } from '../../../rates/rate.service';
import { calcMonthly } from '../../logic/calc-monthly';
import { formatMilli } from '../../logic/rounding';

/** 1か月分の行（計算でエラーが出た月は result を null にする） */
interface MonthRow {
  month: YearMonth;
  result: PremiumResult | null;
  error: boolean;
}

type RowState = 'ok' | 'none' | 'missing' | 'error';

@Component({
  selector: 'app-premium-card',
  imports: [TranslocoPipe],
  templateUrl: './premium-card.html',
  styleUrl: './premium-card.css',
})
export class PremiumCard implements OnInit {
  private readonly rates = inject(RateService);
  private readonly remApi = inject(RemunerationService);
  readonly context = inject(OfficeContext);

  readonly employee = input.required<Employee>();
  /** 表に並べる月（詳細画面の期間の切り替えと連動） */
  readonly months = input.required<YearMonth[]>();

  readonly thisMonth = toYearMonth(todayLocal());
  readonly options = DEFAULT_PREMIUM_OPTIONS; // 事業所の設定ができるまで固定

  // ===== 箱 =====
  private readonly tables = signal<RateTables | null>(null);
  private readonly remunerations = signal<RemunerationDoc[]>([]);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);
  readonly openMonth = signal<YearMonth | null>(null);

  /** 月ごとの保険料（月・報酬の履歴・料率のどれかが変われば自動で計算し直す） */
  readonly rows = computed<MonthRow[]>(() => {
    const tables = this.tables();
    const office = this.context.current();
    if (!tables || !office) return [];
    const employee = this.employee();
    const remunerations = this.remunerations();
    return this.months().map((month) => {
      try {
        const rates = pickRates(office, tables, month);
        const result = calcMonthly({
          month,
          employee,
          remunerations,
          rates,
          options: this.options,
        });
        return { month, result, error: false };
      } catch (err) {
        console.error(err); // データの間違い（折半できない料率など）。画面は止めずにその月だけ「エラー」にする
        return { month, result: null, error: true };
      }
    });
  });

  ngOnInit(): void {
    this.reload();
  }

  /** 料率と報酬の履歴を読み直す（標準報酬のカードで保存・削除したときにも呼ばれる） */
  async reload(): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const [tables, rems] = await Promise.all([
        this.rates.tablesFor(office.id, office),
        this.remApi.list(office.id, this.employee().id),
      ]);
      this.tables.set(tables);
      this.remunerations.set(rems);
    } catch (err) {
      console.error(err);
      this.errorKey.set('premium.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  toggle(month: YearMonth): void {
    this.openMonth.update((m) => (m === month ? null : month));
  }

  // ===== 表示の小道具 =====

  state(row: MonthRow): RowState {
    if (row.error || !row.result) return 'error';
    if (row.result.missing.length > 0) return 'missing';
    if (row.result.groups.length === 0) return 'none';
    return 'ok';
  }

  /** 開いて見る中身があるか */
  hasDetail(row: MonthRow): boolean {
    const s = this.state(row);
    return s === 'ok' || s === 'missing';
  }

  /** 計算できなかった理由（行に出す1つ目） */
  missingKey(row: MonthRow): string {
    const reason = row.result?.missing[0]?.reason ?? 'noRate';
    return `premium.missing.${reason}`;
  }

  isFuture(month: YearMonth): boolean {
    return month > this.thisMonth;
  }

  monthParts(month: YearMonth): { y: string; m: string } {
    return { y: month.slice(0, 4), m: String(Number(month.slice(5))) };
  }

  /** グループの本人分（端数処理の前） */
  employeeBefore(g: PremiumGroup): string {
    return formatMilli(g.lines.reduce((s, l) => s + l.employeeMilli, 0));
  }

  lineRate(l: PremiumLine): string {
    return formatPercent(l.rate.employee + l.rate.employer);
  }

  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  readonly milli = formatMilli;
  readonly pct = formatPercent;
}
