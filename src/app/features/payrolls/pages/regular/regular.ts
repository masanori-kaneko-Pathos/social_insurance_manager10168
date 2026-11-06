import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { Payroll } from '../../../../core/models/payroll';
import { RegularDecision, RegularMethod } from '../../../../core/models/revision';
import {
  RemunerationDoc,
  RemunerationInput,
  StandardRemuneration,
} from '../../../../core/models/remuneration';
import { EmployeeService } from '../../../employees/employee.service';
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
import { PayrollService } from '../../payroll.service';
import { RegularService } from '../../regular.service';

import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
interface View {
  employee: Employee;
  result: RegularResult;
  /** 保存済みの定時決定の記録 */
  decision: RegularDecision | null;
  /** 9月分の標準報酬がもうある（反映済み、または手で入れた） */
  septemberExists: boolean;
  remunerations: RemunerationDoc[];
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
  imports: [HalfWidthDigits, RouterLink, TranslocoPipe],
  templateUrl: './regular.html',
  styleUrl: './regular.css',
})
export class RegularPage {
  private readonly employeesApi = inject(EmployeeService);
  private readonly payrollApi = inject(PayrollService);
  private readonly remunerationApi = inject(RemunerationService);
  private readonly regularApi = inject(RegularService);
  private readonly rates = inject(RateService);
  private readonly route = inject(ActivatedRoute);
  readonly context = inject(OfficeContext);

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
      const [all, tables] = await Promise.all([
        this.employeesApi.list(office.id),
        this.rates.grades(),
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
      const [payrolls, remunerations, decisions] = await Promise.all([
        this.payrollApi.listOfOffice(office.id, ids),
        Promise.all(ids.map((id) => this.remunerationApi.list(office.id, id))),
        this.regularApi.decisions(office.id, ids, year),
      ]);
      const byEmployee = new Map<string, Map<string, Payroll>>();
      for (const p of payrolls) {
        if (!byEmployee.has(p.employeeId)) byEmployee.set(p.employeeId, new Map());
        byEmployee.get(p.employeeId)!.set(p.paidMonth, p);
      }
      const schedule = payrollOf(office);
      this.views.set(
        employees.map((employee, i) => {
          const rems = remunerations[i];
          return {
            employee,
            result: decideRegular({
              year,
              employee,
              payrolls: byEmployee.get(employee.id) ?? new Map(),
              remunerations: rems,
              grades: this.grades!,
              schedule,
            }),
            decision: decisions.get(employee.id) ?? null,
            septemberExists: rems.some((r) => r.from === `${year}-09`),
            remunerations: rems,
          };
        }),
      );
    } catch (err) {
      console.error(err);
      this.errorKey.set('regular.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  canReflect(v: View): boolean {
    const r = v.result;
    return (
      this.context.isAdmin() &&
      !v.septemberExists &&
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
      this.errorKey.set('regular.error.save');
    } finally {
      this.saving.set(false);
    }
  }

  reflect(v: View): Promise<void> {
    if (!this.canReflect(v)) return Promise.resolve();
    return this.write([this.build(v, v.result.status === 'keep' ? 'keep' : 'normal')]);
  }

  reflectAnnual(v: View): Promise<void> {
    if (!this.canReflectAnnual(v)) return Promise.resolve();
    return this.write([this.build(v, 'annual')]);
  }

  /** 年間平均の候補の人は、通常の方法で反映する（年間平均にしたい人は先に個別に反映する） */
  reflectAll(): Promise<void> {
    return this.write(
      this.reflectable().map((v) => this.build(v, v.result.status === 'keep' ? 'keep' : 'normal')),
    );
  }

  // ===== 表示 =====

  readonly name = (e: Employee) => `${e.lastName} ${e.firstName}`;
  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  readonly monthLabel = (m: string) => `${Number(m.slice(5, 7))}`;
  readonly diffLabel = (d: number | null) => (d == null ? '—' : d > 0 ? `+${d}` : String(d));
}
