import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { Payroll } from '../../../../core/models/payroll';
import { RemunerationDoc, RemunerationInput, StandardRemuneration } from '../../../../core/models/remuneration';
import { IrregularDecision, LeaveEndDecision } from '../../../../core/models/revision';
import { todayLocal, toYearMonth, shiftMonth } from '../../../../shared/utils/date';
import { ContractService } from '../../../employees/contract.service';
import { EmployeeService } from '../../../employees/employee.service';
import { RemunerationService } from '../../../employees/remuneration.service';
import { CriteriaService } from '../../../office/criteria.service';
import { OfficeContext } from '../../../office/office-context.service';
import { payrollOf } from '../../../office/office-settings';
import { RateService } from '../../../rates/rate.service';
import { AnnualJudgement, IrregularAnnual } from '../../logic/irregular';
import { InsuranceJudgement, standardAt } from '../../logic/revision-base';
import {
  dayRulesOf,
  groupOf,
  RevisionGroup,
  RevisionItem,
  revisionFromMonth,
  revisionItems,
} from '../../logic/revision-rows';
import { PayrollService } from '../../payroll.service';
import { RevisionService } from '../../revision.service';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { withCapRevisions } from '../../../rates/logic/cap-revision';
import { GradeTableDoc } from '../../../../core/models/rates';
import { SpecialPerson, SpecialRevisionCard } from '../../components/special-revision-card/special-revision-card';
import { WageChangeCard, WageChangeRow } from '../../components/wage-change-card/wage-change-card';
import { DecisionNoticeCard } from '../../../premiums/components/decision-notice-card/decision-notice-card';
import { PersonName } from '../../../../shared/components/person-name/person-name';
import { BonusService } from '../../../premiums/bonus.service';
import { bonusRemunerationOf } from '../../../premiums/logic/bonus-nature';

interface View {
  key: string; // 行の目印（従業員ID・種類・起算月）
  employee: Employee;
  item: RevisionItem;
  group: RevisionGroup;
  remunerations: RemunerationDoc[];
}

/**
 * 改定の候補（随時改定・産休／育休の終了時改定）
 * 給与の実績を入れたあとに開く。候補を確かめて「反映」すると、改定の記録と標準報酬を同時に書く
 * 結果は保存せず、開くたびに計算する（反映した分は「反映済み」に出る）
 */
@Component({
  selector: 'app-revisions',
  imports: [PersonName, DecisionNoticeCard, NgTemplateOutlet, RouterLink, TranslocoPipe, SpecialRevisionCard, WageChangeCard],
  templateUrl: './revisions.html',
  styleUrl: './revisions.css',
})
export class RevisionsPage {
  private readonly employeesApi = inject(EmployeeService);
  private readonly payrollApi = inject(PayrollService);
  private readonly remunerationApi = inject(RemunerationService);
  private readonly contractApi = inject(ContractService);
  private readonly criteriaApi = inject(CriteriaService);
  private readonly rates = inject(RateService);
  private readonly api = inject(RevisionService);
  private readonly bonusApi = inject(BonusService);
  readonly context = inject(OfficeContext);

  readonly today = todayLocal();
  readonly fromMonth = revisionFromMonth(toYearMonth(this.today));
  readonly thisMonth = toYearMonth(this.today);

  readonly views = signal<View[]>([]);
  /** 特例改定のカードに渡す材料（同じ読み込みを使い回す。11/16） */
  readonly specialPeople = signal<SpecialPerson[]>([]);
  readonly gradeTables = signal<GradeTableDoc[]>([]);
  /** 人が足した・外した固定的賃金の変動（B11）と、選べる人 */
  readonly wageRows = signal<WageChangeRow[]>([]);
  readonly wageEmployees = signal<Employee[]>([]);
  readonly loading = signal(true);
  readonly saving = signal<string | null>(null);
  readonly errorKey = signal<string | null>(null);
  readonly savedKey = signal<string | null>(null);
  readonly showOther = signal(false);
  /** 年間平均の材料を開いている行 */
  readonly openAnnual = signal<string | null>(null);
  /** 年間平均：季節的な差か・本人の同意（行ごと） */
  readonly checks = signal<Record<string, { seasonal: boolean; consent: boolean }>>({});
  /** 休業終了時改定：本人から申出を受けた日（行ごと。初期値は今日） */
  readonly requested = signal<Record<string, string>>({});

  readonly groups = computed(() => {
    const by = (g: RevisionGroup) => this.views().filter((v) => v.group === g);
    return {
      candidate: by('candidate'),
      waiting: by('waiting'),
      reflected: by('reflected'),
      other: by('other'),
    };
  });

  constructor() {
    this.load();
  }

  /** 特例改定を反映したあと：画面を出したまま読み直す（カードの「反映しました」を消さない） */
  reload(): void {
    void this.load(true);
  }

  private async load(quiet = false): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    if (!quiet) this.loading.set(true);
    this.errorKey.set(null);
    try {
      const [all, tables, criteria, bonusPayments] = await Promise.all([
        this.employeesApi.list(office.id),
        this.rates.grades(),
        this.criteriaApi.list(),
        this.bonusApi.list(office.id), // 年4回以上の賞与（賞与に係る報酬）を各月の報酬に足すため（11/19）
      ]);
      // 出し始める月より前に辞めた人は読まない（読む回数を減らす）
      const employees = all.filter((e) => !e.retireDate || e.retireDate >= `${this.fromMonth}-01`);
      const perPerson = await Promise.all(
        employees.map(async (e) => {
          const [payrolls, remunerations, contracts, wageChanges] = await Promise.all([
            this.payrollApi.listOfEmployee(office.id, e.id),
            this.remunerationApi.list(office.id, e.id),
            this.contractApi.list(office.id, e.id),
            this.api.wageChanges(office.id, e.id),
          ]);
          return { e, payrolls, remunerations, contracts, wageChanges };
        }),
      );
      const ctx = {
        office: { standardHours: office.standardHours ?? null, specificApplication: office.specificApplication },
        criteria,
        schedule: payrollOf(office),
        gradeTables: tables,
        fromMonth: this.fromMonth,
      };
      const views: View[] = [];
      const special: SpecialPerson[] = [];
      const wageRows: WageChangeRow[] = [];
      for (const { e, payrolls, remunerations, contracts, wageChanges } of perPerson) {
        const byMonth = new Map(payrolls.map((p: Payroll): [string, Payroll] => [p.paidMonth, p]));
        const bonusMonthlyFor = (y: number) => bonusRemunerationOf(e.id, y, bonusPayments).monthly;
        const items = revisionItems(
          { employee: e, contracts, payrolls: byMonth, remunerations, wageChanges, bonusMonthlyFor },
          ctx,
        );
        for (const change of wageChanges) wageRows.push({ employee: e, change });
        // 反映するとき、改定しない保険の今の等級に、届出なしの一斉改定の分も入れる（11/16）
        const withCap = withCapRevisions(remunerations, tables);
        special.push({
          employee: e,
          payrolls: byMonth,
          remunerations: withCap,
          minDaysAt: dayRulesOf({ employee: e, contracts }, ctx).minDaysAt,
        });
        for (const item of items) {
          const start = item.type === 'leaveEnd' ? item.result.startMonth : item.result.start.month;
          views.push({
            key: `${e.id}_${item.type}_${start}`,
            employee: e,
            item,
            group: groupOf(item),
            remunerations: withCap,
          });
        }
      }
      // 改定月の順。同じ月なら休業終了時改定が先（優先順位）
      views.sort(
        (a, b) =>
          a.item.result.revisedFrom.localeCompare(b.item.result.revisedFrom) ||
          (a.item.type === b.item.type ? 0 : a.item.type === 'leaveEnd' ? -1 : 1),
      );
      this.views.set(views);
      this.specialPeople.set(special);
      this.wageRows.set(wageRows);
      this.wageEmployees.set(employees);
      this.gradeTables.set(tables);
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'revision.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  // ===== 固定的賃金の変動ではないので外す（B11。11/17） =====

  /** 自動で見つけた起算月（額が変わった・遡及）を外せるか */
  canDismiss(v: View): boolean {
    return (
      this.context.isAdmin() &&
      v.item.type === 'irregular' &&
      v.group !== 'reflected' &&
      v.item.result.start.source !== 'manual' &&
      !this.saving()
    );
  }

  /** 人が足した起算月か（取り消しは下の一覧から） */
  isManual(v: View): boolean {
    return v.item.type === 'irregular' && v.item.result.start.source === 'manual';
  }

  async dismiss(v: View): Promise<void> {
    const office = this.context.current();
    if (!office || v.item.type !== 'irregular' || !this.canDismiss(v)) return;
    this.saving.set(v.key);
    this.errorKey.set(null);
    try {
      const start = v.item.result.start;
      await this.api.saveWageChange(office.id, v.employee.id, {
        month: start.month,
        source: 'dismissed',
        kind: 'other',
        direction: start.direction,
        note: null,
      });
      await this.load(true);
      this.savedKey.set('wageChange.dismissed');
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'wageChange.error.save'));
    } finally {
      this.saving.set(null);
    }
  }

  // ===== 反映 =====

  requestedOf(v: View): string {
    return this.requested()[v.key] ?? this.today;
  }

  setRequested(v: View, date: string): void {
    this.requested.update((r) => ({ ...r, [v.key]: date }));
  }

  canReflect(v: View): boolean {
    if (!this.context.isAdmin() || v.group !== 'candidate' || this.saving()) return false;
    return v.item.type === 'irregular' || /^\d{4}-\d{2}-\d{2}$/.test(this.requestedOf(v));
  }

  /** 改定後の標準報酬（改定しない保険は今のまま。厚年の資格がない人は今の値を持っておく） */
  private after(v: View, annual: boolean): { health: StandardRemuneration; pension: StandardRemuneration } {
    const r = v.item.result;
    const cur = standardAt(v.remunerations, shiftMonth(r.revisedFrom, -1))!;
    if (annual && v.item.type === 'irregular' && v.item.result.annual) {
      const a = v.item.result.annual;
      const pickA = (j: AnnualJudgement | null, fallback: StandardRemuneration) => (j && j.revise ? j.b : fallback);
      return { health: pickA(a.health, cur.health), pension: pickA(a.pension, cur.pension) };
    }
    const pick = (j: InsuranceJudgement | null, fallback: StandardRemuneration) =>
      j && j.revise ? j.after : fallback;
    return { health: pick(r.health, cur.health), pension: pick(r.pension, cur.pension) };
  }

  // ===== 年間平均（随時改定の保険者算定） =====

  annualOf(v: View): IrregularAnnual | null {
    return v.item.type === 'irregular' ? v.item.result.annual : null;
  }

  toggleAnnual(v: View): void {
    this.openAnnual.update((k) => (k === v.key ? null : v.key));
  }

  checksOf(v: View): { seasonal: boolean; consent: boolean } {
    return this.checks()[v.key] ?? { seasonal: false, consent: false };
  }

  setCheck(v: View, key: 'seasonal' | 'consent', value: boolean): void {
    this.checks.update((c) => ({ ...c, [v.key]: { ...this.checksOf(v), [key]: value } }));
  }

  /** 年間平均で決めると、どちらの保険も今のまま（Q16）か */
  annualKeepsAll(v: View): boolean {
    const a = this.annualOf(v);
    return !!a && !a.health.revise && !a.pension?.revise;
  }

  canReflectAnnual(v: View): boolean {
    const c = this.checksOf(v);
    return this.canReflect(v) && !!this.annualOf(v)?.candidate && c.seasonal && c.consent && !this.annualKeepsAll(v);
  }

  async reflect(v: View, annual = false): Promise<void> {
    if (!this.canReflect(v)) return;
    if (annual && !this.canReflectAnnual(v)) return;
    const office = this.context.current()!;
    const r = v.item.result;
    const avg = r.average!;
    const a = annual ? this.annualOf(v)! : null;
    const { health, pension } = this.after(v, annual);
    const monthlyAmount = a ? a.average : avg.corrected;
    const remuneration: RemunerationInput = {
      from: r.revisedFrom,
      reason: v.item.type === 'irregular' ? 'irregular' : 'leaveEnd',
      monthlyAmount,
      health,
      pension,
    };
    const common = {
      officeId: office.id,
      employeeId: v.employee.id,
      revisedFrom: r.revisedFrom,
      usedMonths: a
        ? a.months.filter((m) => m.used).map((m) => m.month)
        : r.months.filter((m) => m.used).map((m) => m.month),
      total: avg.total,
      average: avg.average,
      monthlyAmount,
      health,
      pension,
    };

    this.saving.set(v.key);
    this.errorKey.set(null);
    this.savedKey.set(null);
    try {
      if (v.item.type === 'irregular') {
        const ir = v.item.result;
        const diff = ir.health?.diff ?? 0;
        const decision: IrregularDecision = {
          ...common,
          startMonth: ir.start.month,
          direction: ir.start.direction === 'unclear' ? (diff >= 0 ? 'up' : 'down') : ir.start.direction,
          corrected: avg.retro > 0 ? avg.corrected : null,
          retro: avg.retro,
          special: !!(ir.health?.revise && ir.health.special) || !!(ir.pension?.revise && ir.pension.special),
          reasonNote: null,
          method: a ? 'annual' : 'normal',
          annualAverage: ir.annual?.candidate ? ir.annual.average : null,
          seasonal: !!a,
          consent: !!a,
        };
        await this.api.reflectIrregular(decision, remuneration);
      } else {
        const le = v.item.result;
        const decision: LeaveEndDecision = {
          ...common,
          startMonth: le.startMonth,
          leaveKind: le.kind,
          leaveEnd: le.leaveEnd,
          requestedOn: this.requestedOf(v),
        };
        await this.api.reflectLeaveEnd(decision, remuneration);
      }
      await this.load();
      this.savedKey.set('revision.saved');
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'revision.error.save'));
    } finally {
      this.saving.set(null);
    }
  }

  // ===== 表示 =====

  readonly name = (e: Employee) => `${e.lastName} ${e.firstName}`;
  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  readonly diffLabel = (d: number) => (d > 0 ? `+${d}` : String(d));

  typeKey(v: View): string {
    return v.item.type === 'irregular' ? 'revision.type.irregular' : `revision.type.${v.item.result.kind}`;
  }

  startOf(v: View): string {
    return v.item.type === 'leaveEnd' ? v.item.result.startMonth : v.item.result.start.month;
  }

  /** あと何か月分の実績が要るか（waiting のとき） */
  missingOf(v: View): number {
    return v.item.result.months.filter((m) => !m.payroll).length;
  }
}
