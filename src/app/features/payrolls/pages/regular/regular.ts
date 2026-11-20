import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { Payroll } from '../../../../core/models/payroll';
import { RegularDecision, RegularMethod } from '../../../../core/models/revision';
import {
  RemunerationDoc,
  RemunerationInput,
  StandardRemuneration,
} from '../../../../core/models/remuneration';
import { ContractService } from '../../../employees/contract.service';
import { EmployeeService } from '../../../employees/employee.service';
import { CriteriaService } from '../../../office/criteria.service';
import { RemunerationService } from '../../../employees/remuneration.service';
import { OfficeContext } from '../../../office/office-context.service';
import { gradeOf, pickGradeTable } from '../../../rates/logic/grade';
import { RateService } from '../../../rates/rate.service';
import { payrollOf } from '../../../office/office-settings';
import {
  decideRegular,
  GradeRows,
  MonthUse,
  RegularInput,
  RegularResult,
  remunerationAt,
} from '../../logic/regular';
import { BonusService } from '../../../premiums/bonus.service';
import { bonusTotalOf } from '../../../premiums/logic/bonus-nature';
import {
  BonusRemuneration,
  bonusRemunerationOf,
  enrolledFromOf,
  NaturePaymentLike,
  monthlyOf,
  windowOf,
} from '../../../premiums/logic/bonus-nature';
import { dayRulesOf, pendingSummerRevision, revisionItems } from '../../logic/revision-rows';
import { PayrollService } from '../../payroll.service';
import { RegularService } from '../../regular.service';

import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
import { Pager } from '../../../../shared/components/pager/pager';
import { PersonListBar } from '../../../../shared/components/person-list-bar/person-list-bar';
import { SortHeader } from '../../../../shared/components/sort-header/sort-header';
import { defaultListOptions, filterAndSort, pageOf, PersonListOptions } from '../../../../shared/logic/person-list';
import { ContractDoc } from '../../../../core/models/contract';
import { contractAt } from '../../../employees/logic/contract-form-model';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { monthsBetween } from '../../../../shared/utils/date';
import { DecisionNoticeCard } from '../../../premiums/components/decision-notice-card/decision-notice-card';
import { PersonName } from '../../../../shared/components/person-name/person-name';
interface View {
  employee: Employee;
  result: RegularResult;
  /** 保存済みの定時決定の記録 */
  decision: RegularDecision | null;
  /** 9月分の標準報酬がもうある（反映済み、または手で入れた） */
  septemberExists: boolean;
  remunerations: RemunerationDoc[];
  /** 7〜9月改定の随時改定（休業終了時改定を含む）がまだ反映されていない（11/16）。candidate なら定時決定の反映を止める */
  pending: { revisedFrom: string; status: 'candidate' | 'waiting' } | null;
  /** 判定の材料（賞与に係る報酬の額を直したら、これで判定し直す。11/19） */
  input: RegularInput;
  /** 年4回以上の賞与（7/1前1年の実績から自動で出した額。11/19） */
  bonusAuto: BonusRemuneration;
  /** 7/1前1年に受けた賞与の回数（性質を問わず。報酬に当たる性質がないのに4回以上なら、性質の確認を促す） */
  bonusCount: number;
}

interface ReflectItem {
  decision: RegularDecision;
  remuneration: RemunerationInput;
  decisionExists: boolean;
}

interface Checks {
  seasonal: boolean;
  consent: boolean;
}

@Component({
  selector: 'app-regular',
  imports: [PersonName, DecisionNoticeCard, HalfWidthDigits, Pager, PersonListBar, RouterLink, SortHeader, TranslocoPipe],
  templateUrl: './regular.html',
  styleUrl: './regular.css',
})
export class RegularPage {
  private readonly employeesApi = inject(EmployeeService);
  private readonly payrollApi = inject(PayrollService);
  private readonly remunerationApi = inject(RemunerationService);
  private readonly regularApi = inject(RegularService);
  private readonly rates = inject(RateService);
  private readonly contractApi = inject(ContractService);
  private readonly criteriaApi = inject(CriteriaService);
  private readonly route = inject(ActivatedRoute);
  readonly context = inject(OfficeContext);
  private readonly transloco = inject(TranslocoService);
  private readonly bonusApi = inject(BonusService);

  readonly year = signal(0);
  readonly views = signal<View[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly savedCount = signal<number | null>(null);
  /** 年間平均の欄を開いている人 */
  readonly openAnnual = signal<string | null>(null);
  /** 賞与に係る報酬の欄を開いている人（11/19） */
  readonly openBonus = signal<string | null>(null);
  /** 賞与に係る報酬の年額を手で直した人（従業員ID → 年額。規程を年の途中で変えた人の「受けたであろう額」。11/19） */
  readonly bonusAnnual = signal<Record<string, number>>({});
  readonly checks = signal<Record<string, Checks>>({});

  private grades: GradeRows | null = null;

  readonly targets = computed(() => this.views().filter((v) => v.result.status !== 'excluded'));
  readonly excluded = computed(() => this.views().filter((v) => v.result.status === 'excluded'));

  // ===== 探す・絞る・並べる・ページ（ほかの人の表と同じ決まり。11/16） =====
  readonly listOptions = signal<PersonListOptions>(defaultListOptions());
  readonly page = signal(1);
  /** 従業員ごとの契約（雇用形態で絞る・随時改定の日数の基準に使う） */
  readonly contracts = signal<ReadonlyMap<string, ContractDoc[]>>(new Map());

  /** 7月1日（算定基礎届の基準日）に効いている契約 */
  private contractOf(v: View): ContractDoc | null {
    const list = this.contracts().get(v.employee.id);
    return list ? contractAt(list, `${this.year()}-07-01`) : null;
  }

  /**
   * 上の集計（上がる・下がる・同じ・従前のまま）を押して絞る（1つだけ。同じものをもう一度押すと全員に戻る。11/20）
   * 表に出す人だけを絞る。集計の数と「まとめて反映」の対象は変わらない
   */
  readonly changeFilter = signal<'up' | 'down' | 'same' | 'keep' | null>(null);

  toggleChange(kind: 'up' | 'down' | 'same' | 'keep' | null): void {
    this.changeFilter.update((cur) => (cur === kind ? null : kind));
    this.page.set(1);
  }

  private matchesChange(v: View): boolean {
    const f = this.changeFilter();
    if (f === null) return true;
    if (f === 'keep') return v.result.status === 'keep';
    return v.result.status === 'decided' && v.result.change === f;
  }

  readonly filtered = computed(() =>
    filterAndSort(
      this.targets(),
      this.listOptions(),
      (v) => v.employee,
      (v) => this.contractOf(v),
      (v) => v.septemberExists, // 「入れたかどうか」＝ 9月分を反映したか
      { dept: (v) => this.deptName(v.employee) ?? '' },
    ).filter((v) => this.matchesChange(v)),
  );
  readonly shown = computed(() => pageOf(this.filtered(), this.page(), this.listOptions().size));

  /** 部署の名前（なし ＝ null） */
  deptName(e: Employee): string | null {
    const id = e.org?.departmentId;
    return id ? (this.context.current()?.departments?.find((d) => d.id === id)?.name ?? null) : null;
  }

  readonly summary = computed(() => {
    const t = this.targets();
    const count = (f: (v: View) => boolean) => t.filter(f).length;
    return {
      all: t.length,
      up: count((v) => v.result.status === 'decided' && v.result.change === 'up'),
      down: count((v) => v.result.status === 'decided' && v.result.change === 'down'),
      same: count((v) => v.result.status === 'decided' && v.result.change === 'same'),
      keep: count((v) => v.result.status === 'keep'),
      incomplete: count((v) => v.result.status === 'incomplete'),
      annual: count((v) => !!v.result.annual?.candidate),
      reflected: count((v) => v.septemberExists),
    };
  });

  /** まとめて反映できる人（決定・従前のままで、9月分がまだない） */
  readonly reflectable = computed(() => this.targets().filter((v) => this.canReflect(v)));

  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((p) => this.load(Number(p.get('year'))));
  }

  private async load(year: number): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    this.loading.set(true);
    this.errorKey.set(null);
    this.openAnnual.set(null);
    this.openBonus.set(null);
    this.bonusAnnual.set({});
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      this.errorKey.set('regular.error.badYear');
      this.loading.set(false);
      return;
    }
    this.year.set(year);
    try {
      const [all, tables, criteria] = await Promise.all([
        this.employeesApi.list(office.id),
        this.rates.grades(),
        this.criteriaApi.list(),
      ]);
      const health = pickGradeTable(tables, 'health', `${year}-09`);
      const pension = pickGradeTable(tables, 'pension', `${year}-09`);
      if (!health || !pension) {
        this.errorKey.set('regular.error.noGrades');
        return;
      }
      this.grades = { health: health.grades, pension: pension.grades };

      // 4/1〜7/1 に在籍していた人だけ（ずっと前に辞めた人は出さない）
      const employees = all.filter(
        (e) => e.hireDate <= `${year}-07-01` && (e.retireDate == null || e.retireDate >= `${year}-04-01`),
      );
      const ids = employees.map((e) => e.id);
      // 契約は、随時改定の支払基礎日数の基準（短時間は11日）を決めるため。ログイン中は覚えている（11/16）
      const [payrolls, remunerations, decisions, contracts, bonusPayments] = await Promise.all([
        // 使うのは前年1月〜当年12月（年間平均は前年7月から、随時改定の年間平均は起算月の前9か月まで見る）。全部は読まない（11/16）
        this.payrollApi.listOfOfficeMonths(office.id, ids, monthsBetween(`${year - 1}-01`, `${year}-12`)),
        Promise.all(ids.map((id) => this.remunerationApi.list(office.id, id))),
        this.regularApi.decisions(office.id, ids, year),
        Promise.all(ids.map((id) => this.contractApi.list(office.id, id))),
        this.bonusApi.list(office.id), // 年4回以上の賞与（賞与に係る報酬）を各月の報酬に足すため（11/19）
      ]);
      this.contracts.set(new Map(ids.map((id, i) => [id, contracts[i]])));
      const byEmployee = new Map<string, Map<string, Payroll>>();
      for (const p of payrolls) {
        if (!byEmployee.has(p.employeeId)) byEmployee.set(p.employeeId, new Map());
        byEmployee.get(p.employeeId)!.set(p.paidMonth, p);
      }
      const schedule = payrollOf(office);
      const revisionCtx = {
        office: { standardHours: office.standardHours ?? null, specificApplication: office.specificApplication },
        criteria,
        schedule,
        gradeTables: tables,
        fromMonth: `${year}-01`,
      };
      this.views.set(
        employees.map((employee, i) => {
          const rems = remunerations[i];
          const own = byEmployee.get(employee.id) ?? new Map<string, Payroll>();
          const input: RegularInput = {
            year,
            employee,
            payrolls: own,
            remunerations: rems,
            grades: this.grades!,
            schedule,
            // 短時間労働者は11日、パートは17日 → 15日（R47。11/16）
            ...dayRulesOf({ employee, contracts: contracts[i] }, revisionCtx),
          };
          const decision = decisions.get(employee.id) ?? null;
          const bonusAuto = bonusRemunerationOf(employee.id, year, bonusPayments, enrolledFromOf(employee));
          // 反映済みなら保存した額、まだなら7/1前1年の実績から出した額
          const bonusMonthly = decision?.bonusMonthly ?? bonusAuto.monthly;
          const bonusMonthlyFor = (y: number) => bonusRemunerationOf(employee.id, y, bonusPayments, enrolledFromOf(employee)).monthly;
          return {
            employee,
            input,
            bonusAuto,
            bonusCount: bonusCountOf(employee.id, year, bonusPayments),
            result: decideRegular({ ...input, bonusMonthly }),
            decision,
            septemberExists: rems.some((r) => r.from === `${year}-09`),
            remunerations: rems,
            pending: pendingSummerRevision(
              revisionItems(
                { employee, contracts: contracts[i], payrolls: own, remunerations: rems, bonusMonthlyFor },
                revisionCtx,
              ),
              year,
            ),
          };
        }),
      );
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'regular.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  canReflect(v: View): boolean {
    const r = v.result;
    return (
      this.context.isAdmin() &&
      !v.septemberExists &&
      v.pending?.status !== 'candidate' &&
      (r.status === 'decided' || (r.status === 'keep' && r.current != null))
    );
  }

  // ===== 賞与に係る報酬の欄（年4回以上の賞与。11/19） =====

  /** 札を出すか：報酬に当たる性質がある・足している・性質を問わず4回以上（性質の確認を促す） */
  bonusBadge(v: View): 'remuneration' | 'check' | null {
    if (v.bonusAuto.natures.length > 0 || v.result.bonusMonthly > 0) return 'remuneration';
    return v.bonusCount >= 4 ? 'check' : null;
  }

  toggleBonus(v: View): void {
    this.openBonus.update((id) => (id === v.employee.id ? null : v.employee.id));
  }

  /** 欄に出す年額（手で直した額 → 自動の額） */
  bonusAnnualOf(v: View): number {
    return this.bonusAnnual()[v.employee.id] ?? v.bonusAuto.annual;
  }

  bonusEdited(v: View): boolean {
    return v.employee.id in this.bonusAnnual();
  }

  /** 年額を手で直す（空・数でなければ自動の額に戻す）→ 判定し直す */
  setBonusAnnual(v: View, text: string): void {
    const n = Number(text.replace(/[,，\s]/g, ''));
    const valid = text.trim() !== '' && Number.isSafeInteger(n) && n >= 0;
    this.bonusAnnual.update((m) => {
      const next = { ...m };
      if (valid) next[v.employee.id] = n;
      else delete next[v.employee.id];
      return next;
    });
    this.redecide(v);
  }

  resetBonusAnnual(v: View): void {
    this.bonusAnnual.update((m) => {
      const next = { ...m };
      delete next[v.employee.id];
      return next;
    });
    this.redecide(v);
  }

  private redecide(v: View): void {
    const bonusMonthly = monthlyOf(this.bonusAnnualOf(v));
    this.views.update((list) =>
      list.map((x) => (x.employee.id === v.employee.id ? { ...x, result: decideRegular({ ...x.input, bonusMonthly }) } : x)),
    );
  }

  readonly bonusWindow = computed(() => windowOf(this.year()));

  // ===== 年間平均の欄 =====

  toggleAnnual(v: View): void {
    this.openAnnual.update((id) => (id === v.employee.id ? null : v.employee.id));
  }

  checksOf(v: View): Checks {
    return this.checks()[v.employee.id] ?? { seasonal: false, consent: false };
  }

  setCheck(v: View, key: keyof Checks, value: boolean): void {
    this.checks.update((c) => ({ ...c, [v.employee.id]: { ...this.checksOf(v), [key]: value } }));
  }

  canReflectAnnual(v: View): boolean {
    const c = this.checksOf(v);
    return this.canReflect(v) && !!v.result.annual?.candidate && c.seasonal && c.consent;
  }

  // ===== 反映 =====

  private build(v: View, method: RegularMethod): ReflectItem {
    const y = this.year();
    const r = v.result;
    const office = this.context.current()!;
    const sum = (ms: MonthUse[]) => ms.filter((m) => m.used).reduce((s, m) => s + m.amount, 0);

    let amount: number;
    let health: StandardRemuneration;
    let pension: StandardRemuneration;
    if (method === 'keep') {
      const cur = remunerationAt(v.remunerations, `${y}-08`)!;
      amount = cur.monthlyAmount;
      health = cur.health;
      pension = cur.pension;
    } else {
      const src = method === 'annual' ? r.annual! : { average: r.average!, next: r.next! };
      amount = src.average;
      health = src.next.health;
      // 厚年の資格がない人（70歳以上被用者など）も、標準報酬相当額として厚年の等級を持っておく
      pension = src.next.pension ?? gradeOf(this.grades!.pension, amount);
    }

    const used = method === 'annual' ? r.annual!.months : r.months;
    const decision: RegularDecision = {
      officeId: office.id,
      employeeId: v.employee.id,
      year: String(y),
      method,
      usedMonths: method === 'keep' ? [] : used.filter((m) => m.used).map((m) => m.month),
      total: method === 'keep' ? 0 : sum(r.months),
      average: r.rawAverage ?? 0,
      corrected: r.hasRetro ? r.average : null,
      annualAverage: r.annual?.average ?? null,
      monthlyAmount: amount,
      seasonal: method === 'annual',
      consent: method === 'annual',
      health,
      pension,
      // 各月の報酬に足した賞与に係る報酬（届の各月の額にも足す。11/19）
      ...(method !== 'keep' && r.bonusMonthly > 0 ? { bonusMonthly: r.bonusMonthly } : {}),
    };
    const remuneration: RemunerationInput = {
      from: `${y}-09`,
      reason: 'regular',
      monthlyAmount: amount,
      health,
      pension,
    };
    return { decision, remuneration, decisionExists: !!v.decision };
  }

  private async write(items: ReflectItem[]): Promise<void> {
    if (this.saving() || items.length === 0) return;
    this.saving.set(true);
    this.savedCount.set(null);
    this.errorKey.set(null);
    try {
      await this.regularApi.reflect(items);
      const n = items.length;
      await this.load(this.year());
      this.savedCount.set(n);
    } catch (err) {
      console.error(err);
      // 大人数は何回かに分けて書くので、途中まで反映されていることがある。表を読み直してから知らせる（11/20）
      await this.load(this.year()).catch(() => undefined);
      this.errorKey.set(errorKeyOf(err, 'regular.error.save'));
    } finally {
      this.saving.set(false);
    }
  }

  /** 9月分から等級が変わるか（ボタンの文言：変わる →「9月分から改定」、同じ →「据え置きで確定」。11/16） */
  changes(v: View): boolean {
    const r = v.result;
    if (r.status !== 'decided' || !r.next) return false;
    if (!r.current) return true;
    return r.next.health.standard !== r.current.health.standard
      || (r.next.pension?.standard ?? null) !== (r.current.pension?.standard ?? null);
  }

  /** 押す前の確かめ：何がどう変わるか（標準報酬の履歴に9月分を足す → 保険料一覧の9月分から新しい額。11/16） */
  private confirmFor(v: View, method: 'normal' | 'annual'): boolean {
    const r = v.result;
    const y = this.year();
    const name = this.name(v.employee);
    const before = r.current ? this.yen(r.current.health.standard) : null;
    const next = method === 'annual' ? r.annual?.next : r.next;
    const after = next ? this.yen(next.health.standard) : before;
    const key =
      r.status === 'keep' || (method === 'normal' && !this.changes(v))
        ? 'regular.confirm.keep'
        : before === null
          ? 'regular.confirm.new'
          : 'regular.confirm.change';
    return window.confirm(this.transloco.translate(key, { name, year: y, before, after }));
  }

  reflect(v: View): Promise<void> {
    if (!this.canReflect(v) || !this.confirmFor(v, 'normal')) return Promise.resolve();
    return this.write([this.build(v, v.result.status === 'keep' ? 'keep' : 'normal')]);
  }

  reflectAnnual(v: View): Promise<void> {
    if (!this.canReflectAnnual(v) || !this.confirmFor(v, 'annual')) return Promise.resolve();
    return this.write([this.build(v, 'annual')]);
  }

  /** 年間平均の候補の人は、通常の方法で反映する（年間平均にしたい人は先に個別に反映する） */
  reflectAll(): Promise<void> {
    const list = this.reflectable();
    const changed = list.filter((v) => this.changes(v)).length;
    const ok = window.confirm(
      this.transloco.translate('regular.confirm.all', { n: list.length, changed, year: this.year() }),
    );
    if (!ok) return Promise.resolve();
    return this.write(list.map((v) => this.build(v, v.result.status === 'keep' ? 'keep' : 'normal')));
  }

  // ===== 表示 =====

  readonly name = (e: Employee) => `${e.lastName} ${e.firstName}`;
  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  /** '2026-07' → 7 */
  readonly monthNum = (ym: string) => Number(ym.slice(5, 7));
  readonly monthLabel = (m: string) => `${Number(m.slice(5, 7))}`;
  readonly diffLabel = (d: number | null) => (d == null ? '—' : d > 0 ? `+${d}` : String(d));
}

/** 7/1前1年に受けた賞与の回数（性質を問わず。分割の続き・その年限りは数えない。11/19） */
function bonusCountOf(employeeId: string, year: number, payments: readonly NaturePaymentLike[]): number {
  const w = windowOf(year);
  return payments.filter(
    (p) =>
      bonusTotalOf(p, employeeId) > 0 &&
      (p.countAs ?? 'normal') === 'normal' &&
      p.paidDate >= w.from &&
      p.paidDate <= w.to,
  ).length;
}
