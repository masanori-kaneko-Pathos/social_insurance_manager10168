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
  RegularResult,
  remunerationAt,
} from '../../logic/regular';
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

  readonly year = signal(0);
  readonly views = signal<View[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly savedCount = signal<number | null>(null);
  /** 年間平均の欄を開いている人 */
  readonly openAnnual = signal<string | null>(null);
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

  readonly filtered = computed(() =>
    filterAndSort(
      this.targets(),
      this.listOptions(),
      (v) => v.employee,
      (v) => this.contractOf(v),
      (v) => v.septemberExists, // 「入れたかどうか」＝ 9月分を反映したか
      { dept: (v) => this.deptName(v.employee) ?? '' },
    ),
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
      const [payrolls, remunerations, decisions, contracts] = await Promise.all([
        // 使うのは前年1月〜当年12月（年間平均は前年7月から、随時改定の年間平均は起算月の前9か月まで見る）。全部は読まない（11/16）
        this.payrollApi.listOfOfficeMonths(office.id, ids, monthsBetween(`${year - 1}-01`, `${year}-12`)),
        Promise.all(ids.map((id) => this.remunerationApi.list(office.id, id))),
        this.regularApi.decisions(office.id, ids, year),
        Promise.all(ids.map((id) => this.contractApi.list(office.id, id))),
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
          return {
            employee,
            result: decideRegular({
              year,
              employee,
              payrolls: byEmployee.get(employee.id) ?? new Map(),
              remunerations: rems,
              grades: this.grades!,
              schedule,
              // 短時間労働者は11日、パートは17日 → 15日（R47。11/16）
              ...dayRulesOf({ employee, contracts: contracts[i] }, revisionCtx),
            }),
            decision: decisions.get(employee.id) ?? null,
            septemberExists: rems.some((r) => r.from === `${year}-09`),
            remunerations: rems,
            pending: pendingSummerRevision(
              revisionItems({ employee, contracts: contracts[i], payrolls: own, remunerations: rems }, revisionCtx),
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
