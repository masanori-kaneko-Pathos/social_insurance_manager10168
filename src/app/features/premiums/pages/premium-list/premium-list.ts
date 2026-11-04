import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { map } from 'rxjs';
import { Employee } from '../../../../core/models/employee';
import { Office } from '../../../../core/models/office';
import { OfficeTotal } from '../../../../core/models/premium';
import { RemunerationDoc } from '../../../../core/models/remuneration';
import { todayLocal } from '../../../../shared/utils/date';
import { EmployeeService } from '../../../employees/employee.service';
import { shiftMonth, toYearMonth, YearMonth } from '../../../employees/logic/coverage';
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
} from '../../../office/office-settings';
import { noRates, pickRates, RateTables } from '../../../rates/logic/pick-rates';
import { RateService } from '../../../rates/rate.service';
import { officeTotals } from '../../logic/premium-core';
import { buildPremiumRow, PremiumRow } from '../../logic/premium-rows';
import { formatMilli } from '../../logic/rounding';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

interface ListItem extends PremiumRow {
  employee: Employee;
}

@Component({
  selector: 'app-premium-list',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './premium-list.html',
  styleUrl: './premium-list.css',
})
export class PremiumList {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly employeesApi = inject(EmployeeService);
  private readonly remApi = inject(RemunerationService);
  private readonly rates = inject(RateService);
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

  /** 計算できなかった人（表の上に警告として出す） */
  readonly problems = computed(() =>
    this.rows().filter((r) => r.state === 'missing' || r.state === 'error'),
  );

  /** 事業所の合計（計算できた人だけ） */
  readonly totals = computed<OfficeTotal[]>(() =>
    officeTotals(this.rows().flatMap((r) => (r.state === 'ok' && r.result ? [r.result] : []))),
  );

  /** 納付額の合計（納入告知書と照らし合わせる用） */
  readonly grandTotalYen = computed(() => this.totals().reduce((s, t) => s + t.totalYen, 0));

  readonly changedCount = computed(() => this.rows().filter((r) => r.changes.length > 0).length);

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
      const [employees, tables] = await Promise.all([
        this.employeesApi.list(officeId),
        this.rates.tablesFor(officeId, everKumiai(office)),
      ]);
      // 報酬の履歴は従業員ごとに分かれているので、人数分を並行で読む
      const lists = await Promise.all(employees.map((e) => this.remApi.list(officeId, e.id)));
      this.remunerations.set(new Map(employees.map((e, i) => [e.id, lists[i]])));
      this.employees.set(employees);
      this.tables.set(tables);
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

  // ===== 表示の小道具 =====

  /** 何月に支払う給与から控除するか */
  readonly payMonth = computed(() => deductionPayMonth(this.month(), this.payroll()));

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
