import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MonthPicker } from '../../../../shared/components/month-picker/month-picker';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { map } from 'rxjs';
import { Employee } from '../../../../core/models/employee';
import { Office } from '../../../../core/models/office';
import { OfficeTotal } from '../../../../core/models/premium';
import { RemunerationDoc } from '../../../../core/models/remuneration';
import { todayLocal, shiftMonth, toYearMonth, YearMonth } from '../../../../shared/utils/date';
import { EmployeeService } from '../../../employees/employee.service';
import { RemunerationService } from '../../../employees/remuneration.service';
import { OfficeContext } from '../../../office/office-context.service';
import {
  DEFAULT_PAYROLL,
  DEFAULT_PREMIUM,
  deductionPayMonth,
  everKumiai,
  insurerFor,
  payrollOf,
  premiumOf,
  ratesForOffice,
} from '../../../office/office-settings';
import { noRates, pickRates, RateTables } from '../../../rates/logic/pick-rates';
import { RateService } from '../../../rates/rate.service';
import { healthPartTotals, officeTotals } from '../../logic/premium-core';
import { buildPremiumRow, PremiumRow } from '../../logic/premium-rows';
import { formatMilli } from '../../logic/rounding';
import { BonusPayment } from '../../../../core/models/bonus';
import { BonusService } from '../../bonus.service';
import { addTotals, collectBonusResults } from '../../logic/bonus-rows';
import { downloadCsv, safeFileName } from '../../../../shared/csv/csv';
import { downloadXlsx } from '../../../../shared/xlsx/download-xlsx';
import { Payroll } from '../../../../core/models/payroll';
import { PayrollService } from '../../../payrolls/payroll.service';
import { advanceAmount, advanceState } from '../../logic/advance';
import { buildPremiumCsv, PremiumCsvRow, premiumFileName } from '../../logic/premium-csv';
import {
  DEFAULT_PREMIUM_SORT,
  nextSort,
  PremiumSort,
  PremiumSortKey,
  sortPremiumRows,
  standardView,
  StandardView,
} from '../../logic/premium-list-view';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

interface ListItem extends PremiumRow {
  employee: Employee;
}

@Component({
  selector: 'app-premium-list',
  imports: [MonthPicker, RouterLink, TranslocoPipe],
  templateUrl: './premium-list.html',
  styleUrl: './premium-list.css',
})
export class PremiumList {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly employeesApi = inject(EmployeeService);
  private readonly remApi = inject(RemunerationService);
  private readonly rates = inject(RateService);
  private readonly bonusApi = inject(BonusService);
  private readonly payrollApi = inject(PayrollService);
  private readonly transloco = inject(TranslocoService);
  readonly context = inject(OfficeContext);

  readonly thisMonth = toYearMonth(todayLocal());
  /** 保険料の計算方法・給与の設定（事業所の設定） */
  readonly options = computed(() => {
    const office = this.context.current();
    return office ? premiumOf(office) : DEFAULT_PREMIUM;
  });
  readonly payroll = computed(() => {
    const office = this.context.current();
    return office ? payrollOf(office) : DEFAULT_PAYROLL;
  });

  /** 見ている月（URL の ?month= から。なければ・読めなければ今月） */
  readonly month = toSignal(
    this.route.queryParamMap.pipe(
      map((p) => {
        const m = p.get('month');
        return m && MONTH.test(m) ? m : this.thisMonth;
      }),
    ),
    { initialValue: this.thisMonth },
  );

  /** 1人ごとの行に拠出金の列を出すか（URL の ?contribution=1。初期値は出さない） */
  readonly showContribution = toSignal(
    this.route.queryParamMap.pipe(map((p) => p.get('contribution') === '1')),
    { initialValue: false },
  );

  // ===== 箱 =====
  private readonly employees = signal<Employee[]>([]);
  private readonly remunerations = signal<Map<string, RemunerationDoc[]>>(new Map());
  private readonly tables = signal<RateTables | null>(null);
  private readonly bonusPayments = signal<BonusPayment[]>([]);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);

  /** 全員分の行（月・データが変わると自動で計算し直す） */
  private readonly allRows = computed<ListItem[]>(() => {
    const tables = this.tables();
    const office = this.context.current();
    if (!tables || !office) return [];
    const month = this.month();
    const options = this.options();
    // その月の保険者・都道府県で料率を選ぶ（移転や組合健保への切り替えの前の月は、前の料率）
    const ratesFor = (m: YearMonth) => {
      const insurer = insurerFor(office, m);
      return insurer ? pickRates(insurer, tables, m) : noRates(m);
    };
    return this.employees().map((employee) => ({
      employee,
      ...buildPremiumRow({
        month,
        employee,
        remunerations: this.remunerations().get(employee.id) ?? [],
        ratesFor,
        options,
      }),
    }));
  });

  /** 表に出す人（その月に加入していない人は隠す） */
  readonly rows = computed(() => this.allRows().filter((r) => r.state !== 'none'));
  readonly hiddenCount = computed(() => this.allRows().length - this.rows().length);

  /** 並べ替え（見出しを押す。月を変えても並びはそのまま） */
  readonly sort = signal<PremiumSort>(DEFAULT_PREMIUM_SORT);
  readonly sortedRows = computed(() => sortPremiumRows(this.rows(), this.sort()));

  sortBy(key: PremiumSortKey): void {
    this.sort.update((cur) => nextSort(cur, key));
  }

  /** 読み上げ用（表の見出しの aria-sort） */
  ariaSort(key: PremiumSortKey): 'ascending' | 'descending' | null {
    const s = this.sort();
    return s.key === key ? (s.dir === 'asc' ? 'ascending' : 'descending') : null;
  }

  arrow(key: PremiumSortKey): string {
    const s = this.sort();
    return s.key === key ? (s.dir === 'asc' ? '▲' : '▼') : '';
  }

  standardOf(r: ListItem): StandardView {
    return standardView(r.health, r.pension);
  }

  /** 計算できなかった人（表の上に警告として出す） */
  readonly problems = computed(() =>
    this.rows().filter((r) => r.state === 'missing' || r.state === 'error'),
  );

  /** 事業所の合計（計算できた人だけ） */
  readonly totals = computed<OfficeTotal[]>(() =>
    officeTotals(this.rows().flatMap((r) => (r.state === 'ok' && r.result ? [r.result] : []))),
  );

  /** 健康保険料の内訳（健康保険・介護保険・子ども・子育て支援金の全額） */
  readonly healthParts = computed(() =>
    healthPartTotals(this.rows().flatMap((r) => (r.state === 'ok' && r.result ? [r.result] : []))),
  );

  /** 納付額の合計（納入告知書と照らし合わせる用） */
  readonly grandTotalYen = computed(() => this.totals().reduce((s, t) => s + t.totalYen, 0));
  /** 本人負担・会社負担の総合計 */
  readonly employeeTotalYen = computed(() => this.totals().reduce((s, t) => s + t.employeeYen, 0));
  readonly employerTotalYen = computed(() => this.totals().reduce((s, t) => s + t.employerYen, 0));

  readonly changedCount = computed(() => this.rows().filter((r) => r.changes.length > 0).length);

  /**
   * その月に払った賞与があるときだけ「月額・賞与・合計」を出す（ない月は null）
   * 1人の本人負担は月額と賞与を別々に端数処理して足す（日本年金機構の説明）。
   * 納付額も月額・賞与それぞれで切り捨てて足すので、告知書と1円違うことがある
   */
  readonly bonusSummary = computed(() => {
    const tables = this.tables();
    const office = this.context.current();
    const month = this.month();
    const payments = this.bonusPayments();
    if (!tables || !office || !payments.some((p) => p.paidDate.startsWith(month))) return null;
    const c = collectBonusResults(
      this.employees(),
      payments,
      { ratesFor: ratesForOffice(office, tables), options: this.options() },
      (d) => d.startsWith(month),
    );
    const bonus = officeTotals(c.results);
    return {
      rows: [
        { key: 'monthly', totals: this.totals() },
        { key: 'bonus', totals: bonus },
        { key: 'sum', totals: addTotals(this.totals(), bonus) },
      ],
      problemCount: c.problemCount,
    };
  });

  /** 月額・賞与の表の列（見出しは1人ごとの表と同じ短い名前） */
  readonly bonusCols = [
    { category: 'health', label: 'premiumList.col.health' },
    { category: 'pension', label: 'premiumList.col.pension' },
    { category: 'childContribution', label: 'premiumList.col.contribution' },
  ] as const;

  totalOf(list: OfficeTotal[], category: OfficeTotal['category']): number {
    return list.find((t) => t.category === category)?.totalYen ?? 0;
  }

  sumOf(list: OfficeTotal[]): number {
    return list.reduce((s, t) => s + t.totalYen, 0);
  }

  constructor() {
    // 事業所が切り替わったら読み直す
    effect(() => {
      const office = this.context.current();
      if (office) this.load(office.id, office);
    });
  }

  private async load(officeId: string, office: Office): Promise<void> {
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      const [employees, tables, bonusPayments] = await Promise.all([
        this.employeesApi.list(officeId),
        this.rates.tablesFor(officeId, everKumiai(office)),
        this.bonusApi.list(officeId),
      ]);
      // 報酬の履歴は従業員ごとに分かれているので、人数分を並行で読む
      const lists = await Promise.all(employees.map((e) => this.remApi.list(officeId, e.id)));
      this.remunerations.set(new Map(employees.map((e, i) => [e.id, lists[i]])));
      this.employees.set(employees);
      this.tables.set(tables);
      this.bonusPayments.set(bonusPayments);
    } catch (err) {
      console.error(err);
      this.errorKey.set('premiumList.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  // ===== 月の切り替え（URL を書き換える。再読み込みや「戻る」でも同じ月になる） =====

  shift(diff: number): void {
    this.goTo(shiftMonth(this.month(), diff));
  }

  /** 拠出金の列を出す・しまう（URL に残すので、再読み込みしても同じ見え方） */
  toggleContribution(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { contribution: this.showContribution() ? null : 1 }, // null で URL から消える
      queryParamsHandling: 'merge',
    });
  }

  goTo(month: YearMonth): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { month },
      queryParamsHandling: 'merge',
    });
  }

  // ===== 書き出し（CSV・Excel） =====

  /** 今見ている月の一覧の表（CSV と xlsx で同じ中身。画面に出ている人だけ。賞与は含まない） */
  private exportTable(): { name: string; rows: string[][] } | null {
    const office = this.context.current();
    if (!office || !this.context.isAdmin()) return null;
    const t = (key: string) => this.transloco.translate(key);
    const lang = this.transloco.getActiveLang() === 'en' ? 'en' : 'ja';
    const rows: PremiumCsvRow[] = this.rows().map((r) => ({
      employeeNumber: r.employee.employeeNumber ?? null,
      name: `${r.employee.lastName} ${r.employee.firstName}`,
      state: r.state as PremiumCsvRow['state'],
      health: r.health ?? null,
      pension: r.pension ?? null,
      care: !!r.care,
      healthEmployeeYen: r.healthEmployeeYen,
      pensionEmployeeYen: r.pensionEmployeeYen,
      employeeYen: r.result?.employeeYen ?? 0,
      employerMilli: r.premiumEmployerMilli,
      totalMilli: r.premiumTotalMilli,
      contributionMilli: r.contributionMilli,
      note:
        r.state === 'ok' ? '' : r.state === 'exempt' ? t('premium.exempt') : t(this.missingKey(r)),
    }));
    const totals = this.totals().map((x) => ({
      label: t(`premiumList.category.${x.category}`),
      totalYen: x.totalYen,
      employeeYen: x.employeeYen,
      employerYen: x.employerYen,
    }));
    return {
      name: safeFileName(premiumFileName(office.name, this.month(), todayLocal(), lang)),
      rows: buildPremiumCsv(rows, totals, lang),
    };
  }

  exportCsv(): void {
    const x = this.exportTable();
    if (x) downloadCsv(x.name, x.rows);
  }

  /** Excel（xlsx）：数字は数値のセル（そのまま足し算・並べ替えができる） */
  async exportXlsx(): Promise<void> {
    const x = this.exportTable();
    if (!x) return;
    try {
      await downloadXlsx(x.name.replace(/\.csv$/, '.xlsx'), this.month(), x.rows);
    } catch (err) {
      console.error(err);
    }
  }

  // ===== 表示の小道具 =====

  /** 何月に支払う給与から控除するか */
  readonly payMonth = computed(() => deductionPayMonth(this.month(), this.payroll()));

  // ===== 保険料の立替（ボタンを押したときだけ、控除する支払月の給与を読む） =====

  /** 確かめた支払月と、その月の給与（従業員ID → 実績） */
  private readonly advanceChecked = signal<{ payMonth: string; payrolls: Map<string, Payroll> } | null>(null);
  readonly advanceBusy = signal(false);
  /** 今見ている月で確かめ済みか（月を変えたら、もう一度押す） */
  readonly advanceReady = computed(() => this.advanceChecked()?.payMonth === this.payMonth());

  /** 立替が要りそうな人（従業員ID → 立て替える額の目安） */
  readonly advances = computed(() => {
    const c = this.advanceChecked();
    const out = new Map<string, number>();
    if (!c || c.payMonth !== this.payMonth()) return out;
    for (const r of this.rows()) {
      if (r.state !== 'ok' || !r.result) continue;
      const p = c.payrolls.get(r.employee.id) ?? null;
      if (advanceState(p, r.result.employeeYen) === 'needed') out.set(r.employee.id, advanceAmount(p!, r.result.employeeYen));
    }
    return out;
  });
  /** 給与の実績がなくて判断できなかった人の数 */
  readonly advanceUnknown = computed(() => {
    const c = this.advanceChecked();
    if (!c || c.payMonth !== this.payMonth()) return 0;
    return this.rows().filter((r) => r.state === 'ok' && r.result && advanceState(c.payrolls.get(r.employee.id) ?? null, r.result.employeeYen) === 'unknown').length;
  });

  async checkAdvance(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || this.advanceBusy()) return;
    this.advanceBusy.set(true);
    try {
      const payMonth = this.payMonth();
      const ids = this.rows().filter((r) => r.state === 'ok').map((r) => r.employee.id);
      this.advanceChecked.set({ payMonth, payrolls: await this.payrollApi.month(officeId, ids, payMonth) });
    } catch (err) {
      console.error(err);
    } finally {
      this.advanceBusy.set(false);
    }
  }

  /** 二以上の事業所に勤務する人がいるか（表の下に注意を出す） */
  readonly hasMultipleOffices = computed(() => this.rows().some((r) => r.employee.multipleOffices));

  monthParts(month: YearMonth): { y: string; m: string } {
    return { y: month.slice(0, 4), m: String(Number(month.slice(5))) };
  }

  missingKey(r: ListItem): string {
    if (r.state === 'error') return 'premium.error.calc';
    return `premium.missing.${r.result?.missing[0]?.reason ?? 'noRate'}`;
  }

  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  readonly milli = formatMilli;
}
