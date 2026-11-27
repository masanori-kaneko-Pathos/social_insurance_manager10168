import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { Recalc, RecalcPeriod } from '../../../../core/models/employee-records';
import { GradeTableDoc } from '../../../../core/models/rates';
import { RemunerationDoc } from '../../../../core/models/remuneration';
import { shiftMonth, todayLocal, toYearMonth, YEAR_MONTH_RE } from '../../../../shared/utils/date';
import { parseNat } from '../../../../shared/utils/number';
import { Enrollment } from '../../../employees/logic/coverage';
import { RemunerationService } from '../../../employees/remuneration.service';
import { OfficeContext } from '../../../office/office-context.service';
import { everKumiai, premiumOf, ratesForOffice } from '../../../office/office-settings';
import { RateTables } from '../../../rates/logic/pick-rates';
import { withCapRevisions } from '../../../rates/logic/cap-revision';
import { RateService } from '../../../rates/rate.service';
import { formatMilli } from '../../logic/rounding';
import { periodOf, recalc, RecalcResult } from '../../logic/recalc';
import { RecalcService } from '../../recalc.service';
import { MonthCloseService } from '../../month-close.service';
import type { ClosedAmount } from '../../logic/month-close';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { SpecialInsuredService } from '../../../employees/special-insured.service';
import { YmPipe } from '../../../../shared/pipes/ym.pipe';

/** 画面の1行：何月から・何月まで（空 ＝ 今も）・報酬月額（「加入していない」なら null） */
interface PeriodRow {
  from: string;
  to: string;
  amount: string;
  notInsured: boolean;
}

interface EnrollmentRow {
  acquiredDate: string;
  lostDate: string;
}

/**
 * 遡及計算（カタログ【9】）
 * 資格取得日・喪失日、標準報酬（期間ごと）を訂正したら、月ごとに当時の料率で計算し直して差額を出す
 * 結果は元のデータとは別に保存する（元の資格・標準報酬は書き換えない）
 */
@Component({
  selector: 'app-recalc-card',
  imports: [YmPipe, TranslocoPipe],
  templateUrl: './recalc-card.html',
  styleUrl: './recalc-card.css',
})
export class RecalcCard implements OnInit {
  private readonly rates = inject(RateService);
  private readonly remApi = inject(RemunerationService);
  private readonly api = inject(RecalcService);
  private readonly closeApi = inject(MonthCloseService);
  readonly context = inject(OfficeContext);

  readonly employee = input.required<Employee>();
  /** 月 → 特定被保険者か（組合健保。制度を使っていなければ null。11/26） */
  private special: ((month: string) => boolean) | null = null;
  private readonly specialApi = inject(SpecialInsuredService);

  readonly today = todayLocal();
  readonly thisMonth = toYearMonth(this.today);

  private tables: RateTables | null = null;
  private gradeTables: GradeTableDoc[] = [];
  private remunerations: RemunerationDoc[] = [];

  readonly saved = signal<Recalc[]>([]);
  readonly openSaved = signal<string | null>(null);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);

  // ===== フォーム（開いているときだけ） =====
  readonly editing = signal(false);
  readonly reason = signal('');
  readonly fixEnrollment = signal(false);
  readonly health = signal<EnrollmentRow>({ acquiredDate: '', lostDate: '' });
  readonly pension = signal<EnrollmentRow>({ acquiredDate: '', lostDate: '' });
  readonly periods = signal<PeriodRow[]>([]);
  readonly from = signal('');
  readonly to = signal('');

  readonly result = signal<RecalcResult | null>(null);
  readonly resultPeriods = signal<RecalcPeriod[]>([]);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);
  /** 計算した期間のうち、月次確定した月の数（訂正前に確定時の額を使った月。11/24） */
  readonly closedCount = signal(0);
  readonly calculating = signal(false);

  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  readonly milli = formatMilli;

  ngOnInit(): void {
    this.load();
  }

  private async load(): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    this.loading.set(true);
    try {
      const [tables, grades, rems, saved] = await Promise.all([
        this.rates.tablesFor(office.id, everKumiai(office)),
        this.rates.grades(),
        this.remApi.list(office.id, this.employee().id),
        this.api.list(office.id, this.employee().id),
      ]);
      this.tables = tables;
      this.gradeTables = grades;
      // 等級の上限が上がった月は、届出なしの一斉改定の行を足す（訂正前・訂正後の両方に効く。11/16）
      this.remunerations = withCapRevisions(rems, grades);
      // 特定被保険者（組合健保。制度を採用している期間があるときだけ扶養家族を読む。11/26）
      this.special = (await this.specialApi.forEmployees(office.id, office, [this.employee()])).get(this.employee().id) ?? null;
      this.saved.set(saved);
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'recalc.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  // ===== フォーム =====

  start(): void {
    const e = this.employee();
    this.reason.set('');
    this.fixEnrollment.set(false);
    this.health.set({ acquiredDate: e.health.acquiredDate ?? '', lostDate: e.health.lostDate ?? '' });
    this.pension.set({ acquiredDate: e.pension.acquiredDate ?? '', lostDate: e.pension.lostDate ?? '' });
    this.periods.set([{ from: '', to: '', amount: '', notInsured: false }]);
    this.from.set(shiftMonth(this.thisMonth, -24));
    this.to.set(this.thisMonth);
    this.result.set(null);
    this.formError.set(null);
    this.editing.set(true);
  }

  cancel(): void {
    this.editing.set(false);
    this.result.set(null);
  }

  setEnrollment(kind: 'health' | 'pension', key: keyof EnrollmentRow, value: string): void {
    const s = kind === 'health' ? this.health : this.pension;
    s.update((r) => ({ ...r, [key]: value }));
    this.result.set(null);
  }

  setPeriod(i: number, patch: Partial<PeriodRow>): void {
    this.periods.update((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    this.result.set(null);
  }

  addPeriod(): void {
    this.periods.update((rows) => [...rows, { from: '', to: '', amount: '', notInsured: false }]);
  }

  removePeriod(i: number): void {
    this.periods.update((rows) => rows.filter((_, j) => j !== i));
    this.result.set(null);
  }

  /** 画面の値 → 訂正の材料（読めなければ formError） */
  private build(): { periods: RecalcPeriod[]; health?: Enrollment; pension?: Enrollment } | null {
    const periods: RecalcPeriod[] = [];
    for (const r of this.periods()) {
      if (!r.from && !r.amount && !r.notInsured) continue; // 空の行は飛ばす
      if (!YEAR_MONTH_RE.test(r.from) || (r.to && !YEAR_MONTH_RE.test(r.to))) {
        this.formError.set('recalc.error.periodMonth');
        return null;
      }
      const amount = r.notInsured ? null : parseNat(r.amount);
      if (amount === undefined || (!r.notInsured && amount === null)) {
        this.formError.set('recalc.error.amount');
        return null;
      }
      const p = periodOf(r.from, r.to || null, amount ?? null, this.gradeTables);
      if (!p) {
        this.formError.set('recalc.error.periodOrder');
        return null;
      }
      periods.push(p);
    }
    const enr = (r: EnrollmentRow): Enrollment => ({
      enrolled: !!r.acquiredDate,
      acquiredDate: r.acquiredDate || null,
      lostDate: r.lostDate || null,
    });
    const fix = this.fixEnrollment();
    if (!fix && periods.length === 0) {
      this.formError.set('recalc.error.nothing');
      return null;
    }
    return { periods, ...(fix ? { health: enr(this.health()), pension: enr(this.pension()) } : {}) };
  }

  async calculate(): Promise<void> {
    this.formError.set(null);
    const office = this.context.current();
    if (!office || !this.tables || this.calculating()) return;
    if (!YEAR_MONTH_RE.test(this.from()) || !YEAR_MONTH_RE.test(this.to()) || this.from() > this.to()) {
      this.formError.set('recalc.error.range');
      return;
    }
    const correction = this.build();
    if (!correction) return;
    const ratesAt = ratesForOffice(office, this.tables);
    // 月次確定した月は、確定時の額（実際に控除した額）を訂正前にする。期間の確定を1回の問い合わせで読む（11/24）
    const closed = new Map<string, ClosedAmount | null>();
    this.calculating.set(true);
    try {
      const id = this.employee().id;
      for (const c of await this.closeApi.range(office.id, this.from(), this.to())) closed.set(c.month, c.people[id] ?? null);
    } catch (err) {
      // 読めなくても計算はする（今のデータを訂正前にする）
      console.error(err);
    } finally {
      this.calculating.set(false);
    }
    // 確定した月に、この人がいなかった（その月は加入していなかった）ときは、確定時 0 円
    const closedAt = (m: string): ClosedAmount | null =>
      closed.has(m) ? (closed.get(m) ?? { e: 0, t: 0, c: 0 }) : null;
    this.closedCount.set(closed.size);
    this.resultPeriods.set(correction.periods);
    this.result.set(
      recalc({
        employee: this.employee(),
        remunerations: this.remunerations,
        correction,
        from: this.from(),
        to: this.to(),
        ratesAt,
        options: premiumOf(office),
        today: this.today,
        closedAt,
        specialInsuredAt: this.special ?? undefined,
      }),
    );
  }

  async save(): Promise<void> {
    const office = this.context.current();
    const r = this.result();
    if (!office || !r || this.saving()) return;
    if (!this.reason().trim()) {
      this.formError.set('recalc.error.reason');
      return;
    }
    this.saving.set(true);
    try {
      await this.api.create(office.id, this.employee().id, {
        reason: this.reason().trim().slice(0, 200),
        periods: this.resultPeriods(),
        months: r.months.map(({ missing: _m, ...m }) => m),
        diffEmployeeYen: r.diffEmployeeYen,
        diffEmployerMilli: r.diffEmployerMilli,
      });
      this.editing.set(false);
      this.result.set(null);
      this.saved.set(await this.api.list(office.id, this.employee().id));
    } catch (err) {
      console.error(err);
      this.formError.set(errorKeyOf(err, 'recalc.error.save'));
    } finally {
      this.saving.set(false);
    }
  }

  async remove(id: string): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    try {
      await this.api.delete(office.id, this.employee().id, id);
      this.saved.update((list) => list.filter((x) => x.id !== id));
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'recalc.error.delete'));
    }
  }

  /** 表示：何円の追加徴収か返金か */
  readonly sign = (n: number) => (n > 0 ? 'collect' : n < 0 ? 'refund' : 'zero');
  readonly abs = Math.abs;
  readonly when = (r: Recalc) => {
    const d = r.createdAt?.toDate?.();
    return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
  };
  readonly expiredCount = computed(() => this.result()?.months.filter((m) => m.expired).length ?? 0);
}
