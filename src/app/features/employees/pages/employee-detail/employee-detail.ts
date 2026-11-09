import { Component, inject, signal, computed } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { EmployeeService } from '../../employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import { premiumOf } from '../../../office/office-settings';
import { todayLocal, ageAt, toYearMonth, fiscalYearOf, monthsLast12, YearMonth, monthsOfCalendarYear, monthsOfFiscalYear } from '../../../../shared/utils/date';
import { coverageForMonths } from '../../logic/coverage';
import { Employee } from '../../../../core/models/employee';
import { RemunerationCard } from '../../components/remuneration-card/remuneration-card';
import { PremiumCard } from '../../../premiums/components/premium-card/premium-card';
import { BonusCard } from '../../../premiums/components/bonus-card/bonus-card';
import { CareExemptionCard } from '../../components/care-exemption-card/care-exemption-card';
import { LeaveCard } from '../../components/leave-card/leave-card';
import { MyPageCard } from '../../../invites/components/my-page-card/my-page-card';
import { ContractCard } from '../../components/contract-card/contract-card';
import { DependentCard } from '../../components/dependent-card/dependent-card';
import { exemptMonth } from '../../logic/leave';
import { PayrollCard } from '../../../payrolls/components/payroll-card/payroll-card';
import { HistoryCard } from '../../components/history-card/history-card';
import { RecalcCard } from '../../../premiums/components/recalc-card/recalc-card';
import { formatPostalCode } from '../../../../shared/utils/text';

type Mode = 'fiscal' | 'calendar' | 'last12';

@Component({
  selector: 'app-employee-detail',
  imports: [
    RouterLink,
    TranslocoPipe,
    RemunerationCard,
    ContractCard,
    DependentCard,
    PremiumCard,
    BonusCard,
    LeaveCard,
    CareExemptionCard,
    MyPageCard,
    PayrollCard,
    HistoryCard,
    RecalcCard,
  ],
  templateUrl: './employee-detail.html',
  styleUrl: './employee-detail.css',
})
export class EmployeeDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly employeesApi = inject(EmployeeService);
  readonly context = inject(OfficeContext);
  /** 事業所の本人負担の集め方（「事業所の設定のまま」の後ろに出す） */
  readonly officeMethod = computed(() => {
    const o = this.context.current();
    return o ? premiumOf(o).method : 'payroll';
  });

  readonly today = todayLocal();
  readonly thisMonth = toYearMonth(this.today);
  readonly employeeId = this.route.snapshot.paramMap.get('employeeId');

  // ===== 箱（signal） =====
  readonly employee = signal<Employee | null>(null);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);

  readonly modes: Mode[] = ['fiscal', 'calendar', 'last12'];
  readonly kinds = ['health', 'care', 'pension'] as const;
  readonly mode = signal<Mode>('fiscal');
  readonly year = signal(fiscalYearOf(this.thisMonth));

  // ===== 自動で計算される箱（computed） =====

  /** 表に並べる12か月 */
  readonly months = computed<YearMonth[]>(() => {
    const mode = this.mode();
    if (mode === 'last12') return monthsLast12(this.thisMonth);
    return mode === 'fiscal' ? monthsOfFiscalYear(this.year()) : monthsOfCalendarYear(this.year());
  });

  /** 月ごとの加入状況 */
  readonly rows = computed(() => {
    const e = this.employee();
    return e ? coverageForMonths(e, this.months()) : [];
  });

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    try {
      const officeId = this.context.current()?.id;
      if (!officeId || !this.employeeId) return;
      const e = await this.employeesApi.get(officeId, this.employeeId);
      if (e) this.employee.set(e);
      else this.errorKey.set('employee.error.notFound');
    } catch (err) {
      console.error(err);
      this.errorKey.set('employee.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  /** 休業カードで保存・削除したら、従業員を読み直す（保険料のカードも自動で計算し直される） */
  async reloadEmployee(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || !this.employeeId) return;
    try {
      const e = await this.employeesApi.get(officeId, this.employeeId);
      if (e) this.employee.set(e);
    } catch (err) {
      console.error(err);
    }
  }

  /** 産休・育休で保険料が免除される月か */
  isExempt(month: YearMonth): boolean {
    return exemptMonth(this.employee()?.leaves, month);
  }

  // ===== ボタンの処理 =====

  /** 区切りを変えたら、年はその区切りでの「今」に戻す */
  setMode(m: Mode): void {
    this.mode.set(m);
    this.year.set(
      m === 'calendar' ? Number(this.thisMonth.slice(0, 4)) : fiscalYearOf(this.thisMonth),
    );
  }

  shift(diff: number): void {
    this.year.update((y) => y + diff);
  }

  // ===== 表示の小道具 =====

  isFuture(month: YearMonth): boolean {
    return month > this.thisMonth;
  }

  age(e: Employee): number {
    return ageAt(e.birthDate, this.today);
  }

  // ===== そのほかの情報の表示 =====

  commute(e: Employee): string {
    return [e.commute.method, e.commute.route].filter((x) => !!x).join('：') || '—';
  }

  /** 基礎年金番号は下4桁だけ見せる */
  pensionNumber(e: Employee): string {
    const n = e.basicPensionNumber;
    return n ? `****-**${n.slice(-4)}` : '—';
  }

  address(e: Employee): string {
    const c = e.contact;
    const zip = c.postalCode ? `〒${formatPostalCode(c.postalCode)} ` : '';
    return zip + (c.address ?? '') || '—';
  }

  /** 外国籍の人のローマ字氏名（姓 名 ミドルネーム）。ないときは null */
  romanName(e: Employee): string | null {
    const f = e.foreign;
    if (!f?.romanLastName) return null;
    return [f.romanLastName, f.romanFirstName, f.romanMiddleName].filter((x) => !!x).join(' ');
  }

  /** 口座番号は下3桁だけ見せる */
  bank(e: Employee): string {
    const b = e.bankAccount;
    if (!b.bankName && !b.accountNumber) return '—';
    const num = b.accountNumber ? `****${b.accountNumber.slice(-3)}` : '';
    return [b.bankName, b.branchName, num].filter((x) => !!x).join(' ');
  }

  /** 印のついている資格の細目 */
  flags(e: Employee): ('multipleOffices' | 'rehired' | 'needsConfirmationCard')[] {
    return (['multipleOffices', 'rehired', 'needsConfirmationCard'] as const).filter((k) => e[k]);
  }

  /** '2026-04' → '4' */
  monthLabel(month: YearMonth): string {
    return String(Number(month.slice(5)));
  }
}
