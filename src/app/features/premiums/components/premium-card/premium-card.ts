import { Component, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { Office } from '../../../../core/models/office';
import {
  PremiumGroup,
  PremiumLine,
  PremiumOptions,
  PremiumResult,
} from '../../../../core/models/premium';
import { RemunerationDoc } from '../../../../core/models/remuneration';
import { todayLocal, toYearMonth, YearMonth } from '../../../../shared/utils/date';
import { emptyReason } from '../../../employees/logic/coverage';
import { RemunerationService } from '../../../employees/remuneration.service';
import { OfficeContext } from '../../../office/office-context.service';
import {
  DEFAULT_PREMIUM,
  everKumiai,
  insurerFor,
  premiumOf,
} from '../../../office/office-settings';
import { noRates, pickRates, RateTables } from '../../../rates/logic/pick-rates';
import { formatPercent } from '../../../rates/logic/rate-format';
import { RateService } from '../../../rates/rate.service';
import { calcMonthly } from '../../logic/calc-monthly';
import { splitContribution } from '../../logic/premium-core';
import { formatMilli } from '../../logic/rounding';

/** 保険料の計算に要る事業所の設定（事業所の文書そのものか、従業員向けに写したもの） */
export type OfficeForPremium = Pick<Office, 'id' | 'prefecture' | 'healthInsurer' | 'insurerHistory' | 'premium'>;

/** 1か月分の行（計算でエラーが出た月は result を null にする） */
interface MonthRow {
  month: YearMonth;
  result: PremiumResult | null;
  error: boolean;
}

type RowState = 'ok' | 'none' | 'missing' | 'error' | 'exempt';

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
  /**
   * 計算に使う事業所の設定。渡さなければ今開いている事業所（OfficeContext）
   * マイページでは、従業員に見せてよい分だけ写した文書（offices/{o}/shared/forEmployees）を渡す
   */
  readonly office = input<OfficeForPremium | null>(null);
  private readonly officeNow = computed<OfficeForPremium | null>(() => this.office() ?? this.context.current());
  /** 表に並べる月（詳細画面の期間の切り替えと連動） */
  readonly months = input.required<YearMonth[]>();
  /** 最初から根拠を開いておく月（保険料一覧の「計算 ›」から来たとき） */
  readonly focusMonth = input<YearMonth | null>(null);

  readonly thisMonth = toYearMonth(todayLocal());
  /** 表の月がすべて空のときの理由（1か月でもかかる月があれば null） */
  readonly empty = computed(() => emptyReason(this.employee(), this.months()));
  /** 保険料の計算方法（事業所の設定） */
  readonly options = computed<PremiumOptions>(() => {
    const office = this.officeNow();
    return office ? premiumOf(office) : DEFAULT_PREMIUM;
  });

  // ===== 箱 =====
  private readonly tables = signal<RateTables | null>(null);
  private readonly remunerations = signal<RemunerationDoc[]>([]);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);
  readonly openMonth = signal<YearMonth | null>(null);

  /** 月ごとの保険料（月・報酬の履歴・料率のどれかが変われば自動で計算し直す） */
  readonly rows = computed<MonthRow[]>(() => {
    const tables = this.tables();
    const office = this.officeNow();
    if (!tables || !office) return [];
    const employee = this.employee();
    const remunerations = this.remunerations();
    const options = this.options();
    return this.months().map((month) => {
      try {
        // その月の保険者・都道府県で料率を選ぶ（移転や組合健保への切り替えの前の月は、前の料率）
        const insurer = insurerFor(office, month);
        const rates = insurer ? pickRates(insurer, tables, month) : noRates(month);
        const result = calcMonthly({ month, employee, remunerations, rates, options });
        return { month, result, error: false };
      } catch (err) {
        console.error(err); // データの間違い（折半できない料率など）。画面は止めずにその月だけ「エラー」にする
        return { month, result: null, error: true };
      }
    });
  });

  /** 読み込みが終わったら、focusMonth の行を開いて画面の真ん中へ（1回だけ） */
  private focused = false;
  private readonly focusEffect = effect(() => {
    const m = this.focusMonth();
    if (this.focused || !m || this.loading()) return;
    if (!this.rows().some((r) => r.month === m && r.result)) return;
    this.focused = true;
    this.openMonth.set(m);
    setTimeout(() => document.getElementById(`premium-${m}`)?.scrollIntoView({ block: 'center' }));
  });

  ngOnInit(): void {
    this.reload();
  }

  /** 料率と報酬の履歴を読み直す（標準報酬のカードで保存・削除したときにも呼ばれる） */
  async reload(): Promise<void> {
    const office = this.officeNow();
    if (!office) return;
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const [tables, rems] = await Promise.all([
        this.rates.tablesFor(office.id, everKumiai(office)),
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
    if (row.result.exempt) return 'exempt';
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

  /** 保険料と拠出金を分けた金額（表の列は保険料だけ） */
  split(row: MonthRow) {
    return splitContribution(row.result!);
  }

  isContribution(g: PremiumGroup): boolean {
    return g.parts.includes('childContribution');
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
