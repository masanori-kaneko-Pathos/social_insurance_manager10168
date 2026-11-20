import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { Payroll } from '../../../../core/models/payroll';
import { downloadCsv, safeFileName } from '../../../../shared/csv/csv';
import { downloadSjisCsv } from '../../../../shared/csv/sjis';
import { NenkinIssue, NenkinPerson, nenkinRows } from '../../logic/nenkin-csv';
import { MonthPicker } from '../../../../shared/components/month-picker/month-picker';
import { ReviewBox } from '../../../reviews/components/review-box/review-box';
import { filingReviewId } from '../../../reviews/logic/review';
import { ageAt, daysInMonth, shiftMonth, todayLocal, toYearMonth, YearMonth } from '../../../../shared/utils/date';
import { ContractService } from '../../../employees/contract.service';
import { DependentService } from '../../../employees/dependent.service';
import { EmployeeService } from '../../../employees/employee.service';
import { classify } from '../../../employees/logic/classify';
import { contractAt } from '../../../employees/logic/contract-form-model';
import { RemunerationService } from '../../../employees/remuneration.service';
import { CriteriaService } from '../../../office/criteria.service';
import { OfficeContext } from '../../../office/office-context.service';
import { payrollOf } from '../../../office/office-settings';
import { findStartMonths } from '../../../payrolls/logic/irregular';
import { latestPaidMonth } from '../../../payrolls/logic/payroll-rows';
import { regularYearOf } from '../../../payrolls/logic/regular';
import { standardAt } from '../../../payrolls/logic/revision-base';
import { PayrollService } from '../../../payrolls/payroll.service';
import { RegularService } from '../../../payrolls/regular.service';
import { RevisionService } from '../../../payrolls/revision.service';
import { BonusService } from '../../../premiums/bonus.service';
import { DecisionNoticeCard } from '../../../premiums/components/decision-notice-card/decision-notice-card';
import { eligibleOn } from '../../../premiums/logic/bonus-rows';
import { isOver70Employee } from '../../../employees/logic/coverage';
import { acquireBonusRemunerationOf, bonusRemunerationOf, enrolledFromOf, irregularBonusYearOf, isNotCovered, isRemunerationBonus, recipientsOf } from '../../../premiums/logic/bonus-nature';
import { acquiredDateOf, acquireRow, addedAcquireBonus, bonusRow, FILING_COLUMNS, FILING_KINDS, filingFileName, FilingKind, FilingRow, irregularRemarks, lossesIn, lossRow, mergeSameMonth, regularRemarks, revisionRow, specialRemarks, specialRow, toCells } from '../../logic/filing-rows';
import { errorKeyOf } from '../../../../shared/utils/error-key';

/**
 * 届書の一覧：様式と期間を選んで「表示」→ 表で確かめて CSV に書き出す
 * 読み込みは「表示」を押したときだけ（画面を開いただけでは読まない）
 * 「届を出した」の記録は持たない（書き出した CSV を控えにする）
 */
@Component({
  selector: 'app-filings',
  imports: [DecisionNoticeCard, MonthPicker, ReviewBox, RouterLink, TranslocoPipe],
  templateUrl: './filings.html',
  styleUrl: './filings.css',
})
export class FilingsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  private readonly employeesApi = inject(EmployeeService);
  private readonly contractsApi = inject(ContractService);
  private readonly dependentsApi = inject(DependentService);
  private readonly remunerationsApi = inject(RemunerationService);
  private readonly criteriaApi = inject(CriteriaService);
  private readonly payrollApi = inject(PayrollService);
  private readonly regularApi = inject(RegularService);
  private readonly revisionApi = inject(RevisionService);
  private readonly bonusApi = inject(BonusService);
  readonly context = inject(OfficeContext);

  readonly kinds = FILING_KINDS;
  readonly today = todayLocal();
  readonly thisMonth = toYearMonth(this.today);

  private readonly q = this.route.snapshot.queryParamMap;
  readonly kind = signal<FilingKind>((FILING_KINDS as readonly string[]).includes(this.q.get('kind') ?? '') ? (this.q.get('kind') as FilingKind) : 'acquire');
  readonly from = signal<YearMonth>(this.monthParam('from') ?? this.thisMonth);
  readonly to = signal<YearMonth>(this.monthParam('to') ?? this.monthParam('from') ?? this.thisMonth);
  readonly year = signal<number>(this.defaultYear());

  readonly loading = signal(false);
  readonly errorKey = signal<string | null>(null);
  /** 表示した結果（様式・期間・行）。条件を変えたら消す */
  readonly result = signal<{ kind: FilingKind; period: string; rows: FilingRow[] } | null>(null);
  readonly columns = computed(() => {
    const r = this.result();
    return r ? FILING_COLUMNS[r.kind] : [];
  });

  private employees: Employee[] | null = null;

  // ===== 届書作成プログラム向け CSV =====
  /** 表示した届の金額（人ごと）。算定基礎届・賞与支払届のときだけ入る */
  private nenkinExtra = new Map<string, Pick<NenkinPerson, 'previous' | 'regular' | 'bonus'>>();
  /** 同じ期間に2回以上の賞与がある人（1人1行の決まりなので、新しいほうだけ出す） */
  private multiBonus = new Set<string>();
  readonly nenkinIssues = signal<NenkinIssue[] | null>(null);
  readonly nenkinMultiBonus = signal<string[]>([]);
  readonly exportingNenkin = signal(false);

  private monthParam(key: string): YearMonth | null {
    const v = this.q.get(key);
    return v && /^\d{4}-\d{2}$/.test(v) ? v : null;
  }

  private defaultYear(): number {
    const office = this.context.current();
    return office ? regularYearOf(latestPaidMonth(this.today, payrollOf(office))) : Number(this.today.slice(0, 4));
  }

  setKind(k: string): void {
    this.kind.set(k as FilingKind);
    this.result.set(null);
  }

  setFrom(m: YearMonth): void {
    this.from.set(m);
    if (this.to() < m) this.to.set(m);
    this.result.set(null);
  }

  setTo(m: YearMonth): void {
    this.to.set(m);
    if (this.from() > m) this.from.set(m);
    this.result.set(null);
  }

  setYear(diff: number): void {
    this.year.update((y) => y + diff);
    this.result.set(null);
  }

  // ===== 表示 =====

  async show(): Promise<void> {
    const office = this.context.current();
    if (!office || this.loading()) return;
    this.loading.set(true);
    this.errorKey.set(null);
    try {
      this.employees ??= await this.employeesApi.list(office.id);
      this.nenkinExtra = new Map();
      this.multiBonus = new Set();
      this.nenkinIssues.set(null);
      this.nenkinMultiBonus.set([]);
      const kind = this.kind();
      const fromDate = `${this.from()}-01`;
      const toDate = `${this.to()}-${String(daysInMonth(this.to())).padStart(2, '0')}`;
      let rows: FilingRow[] = [];
      switch (kind) {
        case 'acquire':
          rows = await this.acquireRows(office.id, fromDate, toDate);
          break;
        case 'loss':
          rows = this.employees.flatMap((e) => lossesIn(e, fromDate, toDate).map((l) => lossRow(e, l)));
          break;
        case 'regular':
          rows = await this.regularRows(office.id, this.year());
          break;
        case 'irregular':
          rows = await this.irregularRows(office.id);
          break;
        case 'bonus':
          rows = await this.bonusRows(office.id, fromDate, toDate);
          break;
      }
      rows.sort((a, b) => (a['dateIso'] ?? '').localeCompare(b['dateIso'] ?? '') || (a['insuredNumber'] ?? '').localeCompare(b['insuredNumber'] ?? '', 'ja', { numeric: true }));
      this.result.set({ kind, period: this.periodText(), rows });
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'filing.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  periodText(): string {
    if (this.kind() === 'regular') return String(this.year());
    return this.from() === this.to() ? this.from() : `${this.from()}_${this.to()}`;
  }

  /** 取得届：取得日が期間内の人。契約（報酬月額の見込み・区分）と扶養家族を、その人の分だけ読む */
  private async acquireRows(officeId: string, from: string, to: string): Promise<FilingRow[]> {
    const office = this.context.current()!;
    const targets = this.employees!.filter((e) => {
      const d = acquiredDateOf(e);
      return !!d && d >= from && d <= to;
    });
    if (targets.length === 0) return [];
    const [criteria, bonusPayments] = await Promise.all([this.criteriaApi.list(), this.bonusApi.list(officeId)]);
    const rows = await Promise.all(
      targets.map(async (e) => {
        const [contracts, dependents, rems] = await Promise.all([
          this.contractsApi.list(officeId, e.id),
          this.dependentsApi.list(officeId, e.id).catch(() => null),
          this.remunerationsApi.list(officeId, e.id).catch(() => []),
        ]);
        const date = acquiredDateOf(e)!;
        const c = contractAt(contracts, date);
        const category = classify(
          { birthDate: e.birthDate, optInDate: e.optInDate, optOutDate: e.optOutDate ?? null, contracts, officer: e.org?.officer ?? null },
          { standardHours: office.standardHours ?? null, specificApplication: office.specificApplication },
          criteria,
          date,
        ).category;
        return acquireRow({
          employee: e,
          pensionFund: office.pensionFund,
          expected: c ? { cash: c.expectedCash, inKind: c.expectedInKind } : null,
          hasDependents: dependents === null ? null : dependents.length > 0,
          shortTime: category === 'shortTime',
          // 年4回以上の賞与がある会社：賞与に係る報酬は「同様の業務に従事し、同様の賞与を受ける者」の平均（局部長通知 2(2)）
          // だれが「同様」かはアプリでは決められないので、自動では足さない。報酬月額のカードで本人が［報酬月額に足す］を
          // 押した（資格取得時決定の報酬月額 ＝ 契約の見込み ＋ 平均）ときだけ、届にも足して備考に書く（11/20）
          bonusMonthly: addedAcquireBonus(
            rems.find((r) => r.reason === 'acquisition' && r.from === date.slice(0, 7))?.monthlyAmount ?? null,
            c ? c.expectedCash + c.expectedInKind : null,
            acquireBonusRemunerationOf(e.id, date, this.employees!, bonusPayments)?.monthly ?? 0,
          ),
        });
      }),
    );
    return rows.filter((r): r is FilingRow => r !== null);
  }

  /** 算定基礎届：その年の定時決定の記録がある人。3〜6月の実績（昇降給の比べ先に3月も）と標準報酬を読む */
  private async regularRows(officeId: string, year: number): Promise<FilingRow[]> {
    const ids = this.employees!.map((e) => e.id);
    const decisions = await this.regularApi.decisions(officeId, ids, year);
    const targets = this.employees!.filter((e) => decisions.has(e.id) && decisions.get(e.id)!.method !== 'keep');
    if (targets.length === 0) return [];
    const tIds = targets.map((e) => e.id);
    // 7月は一時帰休が7/1に解消したかを見るためだけに読む（6月の途中で解消したとき。11/19）
    const months = ['03', '04', '05', '06', '07'].map((m) => `${year}-${m}`);
    // 賞与に係る報酬を足した人がいれば、備考に書く支払月のために支給を読む（11/19）
    const anyBonus = targets.some((e) => (decisions.get(e.id)!.bonusMonthly ?? 0) > 0);
    const [byMonth, rems, bonusPayments] = await Promise.all([
      Promise.all(months.map((m) => this.payrollApi.month(officeId, tIds, m))),
      Promise.all(tIds.map((id) => this.remunerationsApi.list(officeId, id))),
      anyBonus ? this.bonusApi.list(officeId) : Promise.resolve([]),
    ]);
    return targets.map((e, i) => {
      const d = decisions.get(e.id)!;
      const payrolls = new Map<string, Payroll>();
      months.forEach((m, k) => {
        const p = byMonth[k].get(e.id);
        if (p) payrolls.set(m, p);
      });
      const prev = standardAt(rems[i], `${year}-08`);
      // 昇給・降給の月（4〜6月）。一時帰休の始まり・終わりは昇給・降給ではないので除く（11/19）
      const raise = findStartMonths(payrolls).find(
        (s) => s.month >= `${year}-04` && s.month <= `${year}-06` && s.direction !== 'unclear' && s.source !== 'furlough',
      );
      const three = ['04', '05', '06'].map((m) => payrolls.get(`${year}-${m}`) ?? null);
      this.nenkinExtra.set(e.id, {
        previous: prev ? { health: prev.health.standard, pension: prev.pension.standard, from: prev.from } : null,
        regular: {
          // 賞与に係る報酬（年4回以上の賞与）は各月の通貨の額に足す（11/19）
          months: three.map((p) => (p ? { days: p.days, cash: p.cash + (d.bonusMonthly ?? 0), inKind: p.inKind } : null)),
          retro: three.reduce((s, p) => s + (p?.retro ?? 0), 0),
        },
        bonus: null,
      });
      return revisionRow('regular', {
        employee: e,
        month: `${year}-09`,
        firstMonth: `${year}-04`,
        payrolls,
        previous: prev ? { health: prev.health.standard, pension: prev.pension.standard, from: prev.from } : null,
        raise: raise ? { month: raise.month, direction: raise.direction as 'up' | 'down' } : null,
        total: d.total,
        average: d.average,
        corrected: d.corrected,
        remarks: regularRemarks({
          employee: e,
          year,
          annual: d.method === 'annual',
          payrolls,
          bonusMonthly: d.bonusMonthly,
          bonusMonths: (d.bonusMonthly ?? 0) > 0 ? bonusRemunerationOf(e.id, year, bonusPayments).months : [],
        }),
        bonusMonthly: d.bonusMonthly ?? 0,
      });
    });
  }

  /** 月額変更届：改定月が期間内の随時改定・特例改定の記録。実績と標準報酬を、その人の分だけ読む */
  private async irregularRows(officeId: string): Promise<FilingRow[]> {
    const ids = this.employees!.map((e) => e.id);
    const [all, specials] = await Promise.all([
      this.revisionApi.irregularDecisions(officeId, ids),
      this.revisionApi.specialRevisions(officeId, ids),
    ]);
    const decisions = all.filter((d) => d.revisedFrom >= this.from() && d.revisedFrom <= this.to());
    const byId = new Map(this.employees!.map((e) => [e.id, e]));
    // 年4回以上の賞与（賞与に係る報酬）：随時改定で足した額を、支給の記録から出し直す（11/19）
    const bonusPayments = decisions.length > 0 ? await this.bonusApi.list(officeId) : [];
    const bonusOf = (employeeId: string, revisedFrom: string) =>
      bonusRemunerationOf(
        employeeId,
        irregularBonusYearOf(revisedFrom),
        bonusPayments,
        byId.has(employeeId) ? enrolledFromOf(byId.get(employeeId)!) : null,
      );
    const bonusMonthlyOf = (employeeId: string, revisedFrom: string) => bonusOf(employeeId, revisedFrom).monthly;
    // 特例改定：初月の1か月分だけ（月額変更届（特例改定用）。支払基礎日数は記録した日数。下がったときは勤務しなかった日も含む）
    const specialRows = Promise.all(
      specials
        .filter((d) => d.revisedFrom >= this.from() && d.revisedFrom <= this.to() && byId.has(d.employeeId))
        .map(async (d) => {
          const e = byId.get(d.employeeId)!;
          const [map, rems] = await Promise.all([
            this.payrollApi.month(officeId, [e.id], d.firstMonth),
            this.remunerationsApi.list(officeId, e.id),
          ]);
          const payrolls = new Map<string, Payroll>();
          const p = map.get(e.id);
          if (p) payrolls.set(d.firstMonth, { ...p, days: d.days });
          const prev = standardAt(rems, shiftMonth(d.revisedFrom, -1));
          return specialRow({
            employee: e,
            month: d.revisedFrom,
            firstMonth: d.firstMonth,
            payrolls,
            previous: prev ? { health: prev.health.standard, pension: prev.pension.standard, from: prev.from } : null,
            raise: { month: d.firstMonth, direction: d.direction },
            total: d.monthlyAmount,
            average: d.monthlyAmount,
            corrected: d.monthlyAmount,
            remarks: specialRemarks({ employee: e, revisedFrom: d.revisedFrom, direction: d.direction }),
          });
        }),
    );
    const irregularRows = Promise.all(
      decisions
        .filter((d) => byId.has(d.employeeId))
        .map(async (d) => {
          const e = byId.get(d.employeeId)!;
          const months = [0, 1, 2].map((i) => shiftMonth(d.startMonth, i));
          const [maps, rems] = await Promise.all([
            Promise.all(months.map((m) => this.payrollApi.month(officeId, [e.id], m))),
            this.remunerationsApi.list(officeId, e.id),
          ]);
          const payrolls = new Map<string, Payroll>();
          months.forEach((m, k) => {
            const p = maps[k].get(e.id);
            if (p) payrolls.set(m, p);
          });
          const prev = standardAt(rems, shiftMonth(d.revisedFrom, -1));
          return revisionRow('irregular', {
            employee: e,
            month: d.revisedFrom,
            firstMonth: d.startMonth,
            payrolls,
            previous: prev ? { health: prev.health.standard, pension: prev.pension.standard, from: prev.from } : null,
            raise: { month: d.startMonth, direction: d.direction },
            total: d.total,
            average: d.average,
            corrected: d.corrected,
            remarks: irregularRemarks({
              employee: e,
              revisedFrom: d.revisedFrom,
              annual: d.method === 'annual',
              reasonNote: d.reasonNote,
              bonusMonthly: bonusMonthlyOf(e.id, d.revisedFrom),
              bonusMonths: bonusOf(e.id, d.revisedFrom).months,
            }),
            bonusMonthly: bonusMonthlyOf(e.id, d.revisedFrom),
          });
        }),
    );
    const [a, b] = await Promise.all([irregularRows, specialRows]);
    return [...a, ...b];
  }

  /** 賞与支払届：支払日が期間内の支給。支払日に資格がある人だけ（1回の問い合わせ） */
  private async bonusRows(officeId: string, from: string, to: string): Promise<FilingRow[]> {
    const payments = await this.bonusApi.list(officeId);
    const byId = new Map(this.employees!.map((e) => [e.id, e]));
    const bonusDates = new Map<string, string>();
    const paid = payments
      // 賞与の項目で「社会保険の対象外」にした支給（祝い金など）は届に出さない（11/19）
      .filter((p) => p.paidDate >= from && p.paidDate <= to && !isNotCovered(p))
      .flatMap((p) =>
        // 通貨か現物のどちらかを受けた人（現物だけの賞与も届に出す。11/20）
        recipientsOf(p)
          // 年4回以上の「賞与に係る報酬」は賞与支払届を出さない（定時決定で報酬月額に足す。11/19）
          // 70歳以上被用者（75歳以上で健保もない人を含む）は保険料がなくても届を出す（厚生年金保険法27条。11/19）
          .filter(
            (id) =>
              byId.has(id) &&
              (eligibleOn(byId.get(id)!, p.paidDate) || isOver70Employee(byId.get(id)!, p.paidDate)) &&
              !isRemunerationBonus(id, p, payments),
          )
          .map((id) => ({ employeeId: id, paidDate: p.paidDate, cash: p.amounts[id] ?? 0, inKind: p.inKindAmounts?.[id] ?? 0 })),
      );
    // 同じ人・同じ月の賞与は1行に合算する（11/19）
    return mergeSameMonth(paid).map((m) => {
      // 届書作成プログラム向け：1人1行なので、同じ期間に別の月の賞与もあれば新しいほうを使う
      const seen = bonusDates.get(m.employeeId);
      if (seen) this.multiBonus.add(m.employeeId);
      if (!seen || m.paidDate > seen) {
        bonusDates.set(m.employeeId, m.paidDate);
        this.nenkinExtra.set(m.employeeId, { previous: null, regular: null, bonus: { cash: m.cash, inKind: m.inKind } });
      }
      return bonusRow({
        employee: byId.get(m.employeeId)!,
        paidDate: m.paidDate,
        cash: m.cash,
        inKind: m.inKind,
        firstPaidInMonth: m.firstPaidInMonth,
      });
    });
  }

  readonly reviewId = filingReviewId;

  // ===== 書き出し =====

  /** 印刷用の見た目（filings.css の @media print）でブラウザの印刷を開く */
  print(): void {
    window.print();
  }

  /**
   * 届書作成プログラム向けの CSV（Shift_JIS・57項目）：表にいる人の分
   * 住所は鍵付きの文書から読む（書き出すときだけ。人数分の読み込み）
   */
  async exportNenkin(): Promise<void> {
    const office = this.context.current();
    const r = this.result();
    if (!office || !r || !this.employees || this.exportingNenkin()) return;
    this.exportingNenkin.set(true);
    this.errorKey.set(null);
    try {
      const byId = new Map(this.employees.map((e) => [e.id, e]));
      const ids = [...new Set(r.rows.map((x) => x['employeeId']).filter((id): id is string => !!id && byId.has(id)))];
      const persons: NenkinPerson[] = await Promise.all(
        ids.map(async (id) => {
          const e = byId.get(id)!;
          const priv = await this.employeesApi.getPrivate(office.id, id, e).catch(() => null);
          const ex = this.nenkinExtra.get(id);
          return {
            employee: e,
            contact: priv?.contact ?? null,
            previous: ex?.previous ?? null,
            regular: ex?.regular ?? null,
            bonus: ex?.bonus ?? null,
            over70: ageAt(e.birthDate, this.today) >= 70,
          };
        }),
      );
      const { rows, issues } = nenkinRows(
        { prefecture: office.prefecture, officeSymbol: office.officeSymbol, pensionFund: !!office.pensionFund },
        persons,
      );
      const t = (k: string) => this.transloco.translate(k);
      downloadSjisCsv(
        safeFileName(`${t('filing.nenkinFile')}_${t(`filing.kind.${r.kind}`)}_${r.period}_${this.today.replace(/-/g, '')}.csv`),
        rows,
      );
      this.nenkinIssues.set(issues);
      this.nenkinMultiBonus.set([...this.multiBonus].map((id) => {
        const e = byId.get(id);
        return e ? `${e.lastName} ${e.firstName}` : id;
      }));
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'filing.error.nenkin'));
    } finally {
      this.exportingNenkin.set(false);
    }
  }

  exportCsv(): void {
    const r = this.result();
    if (!r) return;
    const t = (k: string) => this.transloco.translate(k);
    const header = FILING_COLUMNS[r.kind].map((c) => t(`filing.col.${c}`));
    const lines = r.rows.map((row) => toCells(r.kind, row));
    downloadCsv(safeFileName(filingFileName(t(`filing.kind.${r.kind}`), r.period, this.today)), [header, ...lines]);
  }
}
