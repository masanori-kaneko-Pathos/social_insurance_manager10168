import { MyNumberCard } from '../../../my-number/components/my-number-card/my-number-card';
import { FamilyMyNumbers } from '../../../my-number/components/family-my-numbers/family-my-numbers';
import { Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ContractDoc } from '../../../../core/models/contract';
import { EmployeeFull } from '../../../../core/models/employee';
import { CriteriaDoc } from '../../../../core/models/master';
import { RemunerationDoc } from '../../../../core/models/remuneration';
import {
  ageAt,
  fiscalYearOf,
  monthsLast12,
  monthsOfCalendarYear,
  monthsOfFiscalYear,
  shiftMonth,
  todayLocal,
  toYearMonth,
  YearMonth,
} from '../../../../shared/utils/date';
import { formatPostalCode } from '../../../../shared/utils/text';
import { ageItems } from '../../../dashboard/logic/todo-board';
import { personTodos } from '../../../dashboard/logic/todos';
import { MyPageCard } from '../../../invites/components/my-page-card/my-page-card';
import { CriteriaService } from '../../../office/criteria.service';
import { OfficeContext } from '../../../office/office-context.service';
import { everKumiai, insurerFor, premiumOf } from '../../../office/office-settings';
import { PayrollCard } from '../../../payrolls/components/payroll-card/payroll-card';
import { BonusCard } from '../../../premiums/components/bonus-card/bonus-card';
import { PremiumCard } from '../../../premiums/components/premium-card/premium-card';
import { RecalcCard } from '../../../premiums/components/recalc-card/recalc-card';
import { calcMonthly } from '../../../premiums/logic/calc-monthly';
import { PremiumBreakdown } from '../../../premiums/components/premium-breakdown/premium-breakdown';
import type { PremiumResult } from '../../../../core/models/premium';
import { toWareki, toWarekiMonth } from '../../../filings/logic/wareki';
import { healthLostDate, isOver70Employee, pensionLostDate } from '../../logic/coverage';
import { noRates, pickRates, RateTables } from '../../../rates/logic/pick-rates';
import { withCapRevisions } from '../../../rates/logic/cap-revision';
import { adjustmentForEmployee } from '../../../premiums/logic/adjustment-office';
import { RateService } from '../../../rates/rate.service';
import { CareExemptionCard } from '../../components/care-exemption-card/care-exemption-card';
import { OverseasCard } from '../../components/overseas-card/overseas-card';
import { TransferCard } from '../../components/transfer-card/transfer-card';
import { PayGroupCard } from '../../components/pay-group-card/pay-group-card';
import { ContractCard } from '../../components/contract-card/contract-card';
import { DependentCard } from '../../components/dependent-card/dependent-card';
import { HistoryCard } from '../../components/history-card/history-card';
import { LeaveCard } from '../../components/leave-card/leave-card';
import { RemunerationCard } from '../../components/remuneration-card/remuneration-card';
import { ContractService } from '../../contract.service';
import { EmployeeService } from '../../employee.service';
import { classify, isInsured, reasonParams } from '../../logic/classify';
import { coverageForMonths, emptyReason } from '../../logic/coverage';
import {
  EMPLOYEE_TABS,
  EmployeeTab,
  MISSING_TAB,
  missingInfo,
  remunerationAt,
  tabOf,
} from '../../logic/employee-overview';
import { exemptMonth, filedLeaves } from '../../logic/leave';
import { RemunerationService } from '../../remuneration.service';
import { registerGaps, registerLarge } from '../../logic/labor-register';
import { errorKeyOf } from '../../../../shared/utils/error-key';

type Mode = 'fiscal' | 'calendar' | 'last12';
/** 「＋登録」のメニューから足すカード（中身がないときは出さない） */
type AddKind = 'payroll' | 'leave' | 'care' | 'overseas' | 'dependent' | 'transfer';

/**
 * 従業員のページ（GitHub 風のタブ）
 * 概要｜雇用・契約｜加入と保険料｜給与と標準報酬｜本人の情報｜履歴。開いているタブは URL（?tab=）に持つ
 * カードは開いたタブの分だけ作られる → 開いたときの読み込みが、そのタブの分だけで済む
 */
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
    OverseasCard,
    TransferCard,
    PayGroupCard,
    MyPageCard,
    MyNumberCard,
    FamilyMyNumbers,
    PayrollCard,
    HistoryCard,
    RecalcCard,
    PremiumBreakdown,
  ],
  templateUrl: './employee-detail.html',
  styleUrl: './employee-detail.css',
})
export class EmployeeDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly employeesApi = inject(EmployeeService);
  private readonly contractsApi = inject(ContractService);
  private readonly criteriaApi = inject(CriteriaService);
  private readonly remApi = inject(RemunerationService);
  private readonly rates = inject(RateService);
  readonly context = inject(OfficeContext);

  readonly today = todayLocal();
  readonly thisMonth = toYearMonth(this.today);
  readonly employeeId = this.route.snapshot.paramMap.get('employeeId');
  /** 履歴のタブは管理者だけ（連絡先・口座の変更前後の値が入るため。ルールでも管理者だけ） */
  readonly tabs = computed(() =>
    this.context.isAdmin() ? EMPLOYEE_TABS : EMPLOYEE_TABS.filter((t) => t !== 'history'),
  );
  readonly missingTab = MISSING_TAB;
  readonly reasonParams = reasonParams;

  /** 事業所の本人負担の集め方（「事業所の設定のまま」の後ろに出す） */
  readonly officeMethod = computed(() => {
    const o = this.context.current();
    return o ? premiumOf(o).method : 'payroll';
  });

  // ===== タブ（URL） =====
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  readonly tab = computed<EmployeeTab>(() => tabOf(this.params().get('tab')));
  /** 保険料一覧の「計算 ›」から来たとき（?month=2026-11）：その月の根拠を開く */
  readonly focusMonth = computed<YearMonth | null>(() => {
    const m = this.params().get('month');
    return m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? (m as YearMonth) : null;
  });

  // ===== 箱（signal） =====
  readonly employee = signal<EmployeeFull | null>(null);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);
  /** 概要の材料（読めなければ null のまま。概要のその欄が出ないだけ） */
  private readonly contracts = signal<ContractDoc[] | null>(null);
  private readonly criteria = signal<CriteriaDoc[] | null>(null);
  private readonly remunerations = signal<RemunerationDoc[] | null>(null);
  private readonly tables = signal<RateTables | null>(null);
  /** 「＋登録」で開いたカード */
  readonly adding = signal<AddKind | null>(null);
  private readonly leaveCard = viewChild(LeaveCard);
  private readonly careCard = viewChild(CareExemptionCard);
  private readonly overseasCard = viewChild(OverseasCard);
  private readonly transferCard = viewChild(TransferCard);
  private readonly dependentCard = viewChild(DependentCard);
  private readonly payrollCard = viewChild(PayrollCard);

  readonly modes: Mode[] = ['fiscal', 'calendar', 'last12'];
  readonly kinds = ['health', 'care', 'pension'] as const;
  readonly mode = signal<Mode>('fiscal');
  readonly year = signal(fiscalYearOf(this.focusMonth() ?? this.thisMonth)); // その月を含む年度から見せる

  // ===== 加入と保険料のタブ =====

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

  /** 表の月がすべて空のときの理由（1か月でもかかる月があれば null） */
  readonly empty = computed(() => {
    const e = this.employee();
    return e ? emptyReason(e, this.months()) : null;
  });

  // ===== 概要のタブ =====

  private readonly classifyOffice = computed(() => {
    const o = this.context.current();
    return o ? { standardHours: o.standardHours ?? null, specificApplication: o.specificApplication } : null;
  });

  /** 今日の被保険者区分（退職した人・材料がないときは null） */
  readonly classification = computed(() => {
    const e = this.employee();
    const office = this.classifyOffice();
    const contracts = this.contracts();
    const criteria = this.criteria();
    if (!e || !office || !contracts || !criteria) return null;
    if (e.retireDate && e.retireDate < this.today) return null;
    return classify(
      { birthDate: e.birthDate, optInDate: e.optInDate, optOutDate: e.optOutDate ?? null, contracts, officer: e.org?.officer ?? null },
      office,
      criteria,
      this.today,
    );
  });
  readonly insured = isInsured;

  /** 今の標準報酬月額 */
  readonly remunerationNow = computed(() => {
    const rows = this.remunerations();
    return rows ? remunerationAt(rows, this.thisMonth) : null;
  });

  /** 今月分の保険料の計算結果（計算できないときは null。社会保険のまとめの明細と、概要の本人負担に使う。11/25） */
  readonly premiumResultNow = computed<PremiumResult | null>(() => {
    const e = this.employee();
    const office = this.context.current();
    const tables = this.tables();
    const rems = this.remunerations();
    if (!e || !office || !tables || !rems) return null;
    try {
      const month = this.thisMonth;
      const insurer = insurerFor(office, month);
      const rates = insurer ? pickRates(insurer, tables, month) : noRates(month);
      // 保険料調整制度を使っている事業所では、下の保険料のカードと同じく軽減後の額（11/16）
      const contracts = this.contracts();
      const criteria = this.criteria();
      const since = office.premiumAdjustment?.since;
      const adjustment =
        since && contracts && criteria
          ? adjustmentForEmployee({ ...office, since, standardHours: office.standardHours ?? null }, e, contracts, criteria, rems)(month)
          : null;
      const r = calcMonthly({ month, employee: e, remunerations: rems, rates, options: premiumOf(office), adjustment });
      return r.exempt || r.missing.length === 0 ? r : null;
    } catch (err) {
      console.error(err);
      return null;
    }
  });

  /** 今月分の本人負担（計算できないときは null。免除の月は 'exempt'） */
  readonly premiumNow = computed<number | 'exempt' | null>(() => {
    const r = this.premiumResultNow();
    if (!r) return null;
    return r.exempt ? 'exempt' : r.employeeYen;
  });

  // ===== 社会保険のまとめ（加入と保険料のタブの一番上。届の欄の順に、健保と厚年を左右に並べる。11/25） =====
  readonly wareki = toWareki;
  readonly warekiMonth = toWarekiMonth;
  /** 今日、70歳以上被用者か（厚年の標準報酬月額は「相当額」として出す） */
  over70Now(e: EmployeeFull): boolean {
    return isOver70Employee(e, this.today);
  }
  /**
   * 喪失年月日（年齢による喪失も含む：厚年は70歳到達日、健保は75歳の誕生日）
   * 今日より後の年齢による喪失（まだ先の70歳・75歳）は出さない。入っている喪失日（退職など）はそのまま出す
   */
  lostOf(e: EmployeeFull, kind: 'health' | 'pension'): string | null {
    const x = kind === 'health' ? e.health : e.pension;
    if (!x.enrolled) return null;
    const d = kind === 'health' ? healthLostDate(e) : pensionLostDate(e);
    if (!d) return null;
    return d === x.lostDate || d <= this.today ? d : null;
  }

  /** この人の To-do（To-do リストと同じ計算を1人分。片づけるのは To-do リストで） */
  readonly todos = computed(() => {
    const e = this.employee();
    const office = this.classifyOffice();
    const contracts = this.contracts();
    const criteria = this.criteria();
    if (!e || !office || !contracts || !criteria) return [];
    const todos = personTodos(
      { ...e, optOutDate: e.optOutDate ?? null, contracts, certificate: e.foreign?.certificate ?? null },
      office,
      criteria,
      this.today,
    ).map((t) => ({ kind: t.kind as string, date: t.date, todo: t, age: null as number | null }));
    const ages = ageItems([e], this.thisMonth, shiftMonth(this.thisMonth, 1), this.today).map((a) => ({
      kind: 'age',
      date: a.date,
      todo: null,
      age: a.age?.age ?? null,
    }));
    return [...todos, ...ages];
  });

  /** 足りない情報（住所は、読める人＝管理者のときだけ見る） */
  readonly missing = computed(() => {
    const e = this.employee();
    const contracts = this.contracts();
    if (!e || !contracts || !this.remunerations()) return [];
    return missingInfo(e, {
      // 役員は雇用契約がなくてよい（役員の判定で区分を決める。11/16）
      hasContract: contracts.length > 0 || !!e.org?.officer,
      remunerationNow: !!this.remunerationNow(),
      address: this.context.isAdmin() ? e.contact.address : undefined,
      today: this.today,
    });
  });

  // ===== 労働者名簿の記入漏れ（管理者だけ。業務の種類は常時30人以上の事業所だけ。11/24） =====
  private readonly registerLargeFlag = signal(false);
  readonly registerGaps = computed(() => {
    const e = this.employee();
    if (!e || !this.context.isAdmin()) return [];
    return registerGaps(e, this.today, this.registerLargeFlag());
  });

  constructor() {
    void this.load();
    // ほかの画面から「休業を登録」で来たとき（?add=leave。給与の入力の「状態」の注記から。11/25）
    // 従業員を読み終えてから、休業のカードの追加の欄を開く。開いたら URL から add を消す（戻る・再読み込みで開き直さない）
    effect(() => {
      const kind = this.params().get('add');
      if ((kind !== 'leave' && kind !== 'payroll') || !this.employee() || !this.context.isAdmin()) return;
      untracked(() => void this.openAdd(kind, true));
    });
  }

  private async load(): Promise<void> {
    const officeId = this.context.current()?.id;
    try {
      if (!officeId || !this.employeeId) return;
      const e = await this.employeesApi.getFull(officeId, this.employeeId);
      if (e) this.employee.set(e);
      else this.errorKey.set('employee.error.notFound');
      // 常時30人以上か（一覧は覚えているので、ふつうは読みに行かない）
      void this.employeesApi
        .list(officeId)
        .then((list) => this.registerLargeFlag.set(registerLarge(list, this.today)))
        .catch((err) => console.error(err));
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'employee.error.load'));
    } finally {
      this.loading.set(false);
    }
    void this.loadOverview();
  }

  /** 概要の材料（契約・基準・標準報酬・料率）。どれかが読めなくても、ほかは出す */
  async loadOverview(): Promise<void> {
    const office = this.context.current();
    if (!office || !this.employeeId) return;
    const id = this.employeeId;
    const settle = <T>(p: Promise<T>, set: (v: T) => void) =>
      p.then(set).catch((err) => console.error(err));
    await Promise.all([
      settle(this.contractsApi.list(office.id, id), (v) => this.contracts.set(v)),
      settle(this.criteriaApi.list(), (v) => this.criteria.set(v)),
      // 等級の上限が上がった月は、届出なしの一斉改定の行を足す（保存はしない。11/16）
      settle(Promise.all([this.remApi.list(office.id, id), this.rates.grades()]), ([v, g]) =>
        this.remunerations.set(withCapRevisions(v, g)),
      ),
      settle(this.rates.tablesFor(office.id, everKumiai(office)), (v) => this.tables.set(v)),
    ]);
  }

  /** カードで保存・削除したら、従業員と概要の材料を読み直す */
  async reloadEmployee(): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || !this.employeeId) return;
    try {
      const e = await this.employeesApi.getFull(officeId, this.employeeId);
      if (e) this.employee.set(e);
    } catch (err) {
      console.error(err);
    }
    void this.loadOverview();
  }

  /** 産休・育休で保険料が免除される月か（申出書を出した休業だけ。11/19） */
  isExempt(month: YearMonth): boolean {
    return exemptMonth(filedLeaves(this.employee()?.leaves), month);
  }

  // ===== タブと「＋登録」 =====

  tabLink(t: EmployeeTab): Record<string, string | null> {
    return { tab: t === 'overview' ? null : t };
  }

  /** 休業・介護保険料がかからない期間：中身があるか、「＋登録」で開いたときだけ出す */
  showLeave(e: EmployeeFull): boolean {
    return e.leaves.length > 0 || this.adding() === 'leave';
  }

  showCare(e: EmployeeFull): boolean {
    return (e.careExemptions ?? []).length > 0 || this.adding() === 'care';
  }

  showOverseas(e: EmployeeFull): boolean {
    return (e.overseas ?? []).length > 0 || this.adding() === 'overseas';
  }

  /** 「＋登録」：雇用・契約のタブを開いて、そのカードの追加の欄を開く */
  async add(kind: AddKind, menu: HTMLDetailsElement): Promise<void> {
    menu.open = false;
    await this.openAdd(kind);
  }

  /** 追加の欄を開く（fromLink：ほかの画面のリンクから来たとき。URL の add を消す） */
  private async openAdd(kind: AddKind, fromLink = false): Promise<void> {
    this.adding.set(kind);
    // 給与は給与と標準報酬のタブ（11/25）、扶養家族は本人の情報のタブ、ほかは雇用・契約のタブ（11/17 に扶養家族も足した）
    const tab = kind === 'payroll' ? 'pay' : kind === 'dependent' ? 'person' : 'employment';
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab, ...(fromLink ? { add: null } : {}) },
      queryParamsHandling: 'merge',
      replaceUrl: fromLink,
    });
    // カードが画面に出てから追加の欄を開く
    setTimeout(() => {
      // 給与：支払日を過ぎた最新の月の入力を開く（11/25）
      if (kind === 'payroll') {
        this.payrollCard()?.open();
        return;
      }
      // 異動はカードを開くだけ（追加の欄ではない。11/24）
      if (kind === 'transfer') {
        this.transferCard()?.start();
        return;
      }
      const card =
        kind === 'leave'
          ? this.leaveCard()
          : kind === 'care'
            ? this.careCard()
            : kind === 'overseas'
              ? this.overseasCard()
              : this.dependentCard();
      card?.startAdd();
    });
  }

  // ===== 月ごとの加入状況の操作 =====

  /** 区切りを変えたら、年はその区切りでの「今」に戻す */
  setMode(m: Mode): void {
    this.mode.set(m);
    this.year.set(m === 'calendar' ? Number(this.thisMonth.slice(0, 4)) : fiscalYearOf(this.thisMonth));
  }

  shift(diff: number): void {
    this.year.update((y) => y + diff);
  }

  // ===== 表示の小道具 =====

  isFuture(month: YearMonth): boolean {
    return month > this.thisMonth;
  }

  age(e: EmployeeFull): number {
    return ageAt(e.birthDate, this.today);
  }

  yen(n: number): string {
    return n.toLocaleString('ja-JP');
  }

  commute(e: EmployeeFull): string {
    return [e.commute.method, e.commute.route].filter((x) => !!x).join('：') || '—';
  }

  /** 基礎年金番号は下4桁だけ見せる */
  pensionNumber(e: EmployeeFull): string {
    const n = e.basicPensionNumber;
    return n ? `****-**${n.slice(-4)}` : '—';
  }

  address(e: EmployeeFull): string {
    const c = e.contact;
    const zip = c.postalCode ? `〒${formatPostalCode(c.postalCode)} ` : '';
    return zip + (c.address ?? '') || '—';
  }

  livingAddress(e: EmployeeFull): string {
    const c = e.contact;
    const zip = c.livingPostalCode ? `〒${formatPostalCode(c.livingPostalCode)} ` : '';
    return zip + (c.livingAddress ?? '') || '—';
  }

  /** 外国籍の人のローマ字氏名（姓 名 ミドルネーム）。ないときは null */
  romanName(e: EmployeeFull): string | null {
    const f = e.foreign;
    if (!f?.romanLastName) return null;
    return [f.romanLastName, f.romanFirstName, f.romanMiddleName].filter((x) => !!x).join(' ');
  }

  /** 口座番号は下3桁だけ見せる */
  bank(e: EmployeeFull): string {
    const b = e.bankAccount;
    if (!b.bankName && !b.accountNumber) return '—';
    const num = b.accountNumber ? `****${b.accountNumber.slice(-3)}` : '';
    return [b.bankName, b.branchName, num].filter((x) => !!x).join(' ');
  }

  /** 印のついている資格の細目 */
  flags(e: EmployeeFull): ('multipleOffices' | 'rehired' | 'needsConfirmationCard')[] {
    return (['multipleOffices', 'rehired', 'needsConfirmationCard'] as const).filter((k) => e[k]);
  }

  /** '2026-04' → '4' */
  monthLabel(month: YearMonth): string {
    return String(Number(month.slice(5)));
  }
}
