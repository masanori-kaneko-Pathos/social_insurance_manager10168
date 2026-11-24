import { Component, computed, DestroyRef, ElementRef, inject, signal, viewChild, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { Payroll, PayrollLine, PayrollState } from '../../../../core/models/payroll';
import { PayrollItem, PayrollItemInput } from '../../../../core/models/payroll-item';
import { EmployeeService } from '../../../employees/employee.service';
import { ContractService } from '../../../employees/contract.service';
import { contractAt } from '../../../employees/logic/contract-form-model';
import { OfficeContext } from '../../../office/office-context.service';
import { candidateDays, PayrollRowText, readEntry, RowError, sameInput, sumPayrolls, textOf } from '../../logic/payroll-input';
import { categoryOf, copyNames, hasAmounts, LineDraft, startDrafts, toDrafts } from '../../logic/payroll-lines';
import { latestPaidMonth, onLeaveDuring, Period, PayrollRow, payrollRows, periodOf } from '../../logic/payroll-rows';
import { payrollOf, premiumMonthOfPay, premiumMonthsOfPay } from '../../../office/office-settings';
import { MonthPicker } from '../../../../shared/components/month-picker/month-picker';
import { shiftMonth, daysInclusive, daysInMonth, todayLocal, toYearMonth } from '../../../../shared/utils/date';
import { PayrollChange, PayrollService } from '../../payroll.service';
import { PayrollItemService } from '../../payroll-item.service';
import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
import { toHalfWidth } from '../../../../shared/utils/text';
import { InKindCalculator } from '../../components/in-kind-calculator/in-kind-calculator';
import { PayrollEntry, PayrollRowForm } from '../../components/payroll-entry/payroll-entry';
import { PersonListBar } from '../../../../shared/components/person-list-bar/person-list-bar';
import { Pager } from '../../../../shared/components/pager/pager';
import { SortHeader } from '../../../../shared/components/sort-header/sort-header';
import { defaultListOptions, filterAndSort, pageOf, PersonListOptions } from '../../../../shared/logic/person-list';
import { ContractDoc, EMPLOYMENT_TYPES } from '../../../../core/models/contract';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { watchUnsaved } from '../../../../shared/services/unsaved-changes';
import { PersonName } from '../../../../shared/components/person-name/person-name';

interface ViewRow {
  employee: Employee;
  row: PayrollRow;
  form: PayrollRowForm;
  /** 給与明細の内訳（null ＝ 内訳なし）。内訳を変えると form の総支給額なども変わる */
  lines: WritableSignal<LineDraft[] | null>;
}

/** 一覧の「状態」の列 */
export type RowStatus = 'notSaved' | 'saved' | 'edited' | 'unclassified';

const MONTH_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/**
 * 給与の月の画面（11/24 に作り替え）
 * 一覧は表示だけ（社員番号・氏名・部署・雇用形態・総支給額・固定的賃金・支払基礎日数・状態）。
 * 「内訳」を押すと、その行の下に給与明細の内訳を開いて入れる（app-payroll-entry）。「保存して次の人へ」で1人ずつ保存する。
 * 支払基礎日数の「まとめて入れる」は一覧のまま使えるので、直した行は下の帯の「保存する」でまとめて保存する
 */
/** 入力済みの月がない人（同じ空の Set を使い回す） */
const EMPTY_MONTHS: ReadonlySet<string> = new Set();

@Component({
  selector: 'app-payroll-month',
  imports: [PersonName, HalfWidthDigits, InKindCalculator, MonthPicker, Pager, PayrollEntry, PersonListBar, ReactiveFormsModule, RouterLink, SortHeader, TranslocoPipe],
  templateUrl: './payroll-month.html',
  styleUrl: './payroll-month.css',
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'bulkOpen.set(false)',
  },
})
export class PayrollMonth {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly employeesApi = inject(EmployeeService);
  private readonly payrollApi = inject(PayrollService);
  private readonly itemsApi = inject(PayrollItemService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly context = inject(OfficeContext);

  readonly month = signal('');
  readonly period = signal<Period | null>(null);
  readonly views = signal<ViewRow[]>([]);
  /** 給与の項目（項目名 → 分類。読めなくても入力はできる：よくある名前の分類は効く） */
  readonly items = signal<PayrollItem[]>([]);
  /** 事業所の内訳のひな形（null ＝ まだない：アプリの例を並べる） */
  readonly template = signal<string[] | null>(null);
  /** 保存していない入力があれば、画面（月）を離れる前に確かめる（11/17） */
  private readonly unsaved = watchUnsaved(() => this.anyDirty());
  /** 直した行があるか（「保存する」は、直したときだけ下の帯に出す。11/18） */
  anyDirty(): boolean {
    return this.views().some((v) => v.form.dirty);
  }
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly savedCount = signal<number | null>(null);
  /** 行ごとのエラー（従業員ID → エラー） */
  readonly rowErrors = signal<ReadonlyMap<string, RowError[]>>(new Map());

  /** 内訳を開いている人（同時に1人だけ） */
  readonly openId = signal<string | null>(null);
  /** 前の月の内訳（項目名を写す。開いたときに読む。従業員ID → 行。内訳がなければ null） */
  readonly prevLines = signal<ReadonlyMap<string, PayrollLine[] | null>>(new Map());
  /** 前の12か月の「入力済みの人」（月の索引。内訳の「本来の月」に実績があるかを知らせる。11/24） */
  private readonly savedByMonth = signal<ReadonlyMap<string, Set<string>> | null>(null);
  /** 従業員ID → 実績が入っている支払月（前の12か月） */
  readonly savedMonthsById = computed(() => {
    const byMonth = this.savedByMonth();
    const out = new Map<string, Set<string>>();
    if (!byMonth) return out;
    for (const [m, ids] of byMonth) {
      for (const id of ids) {
        if (!out.has(id)) out.set(id, new Set());
        out.get(id)!.add(m);
      }
    }
    return out;
  });

  /** その人の入力済みの月（索引をまだ読めていなければ null ＝ 知らせない） */
  savedMonthsOf(id: string): ReadonlySet<string> | null {
    return this.savedByMonth() ? (this.savedMonthsById().get(id) ?? EMPTY_MONTHS) : null;
  }

  /** 対象期間に休業が重なる人（「休業」の札。11/20） */
  onLeave(e: Employee): boolean {
    const p = this.period();
    return p ? onLeaveDuring(e, p) : false;
  }

  readonly periodDays = computed(() => {
    const p = this.period();
    return p ? daysInclusive(p.start, p.end) : 0;
  });
  readonly thisMonth = toYearMonth(todayLocal());

  /** '2026-10' → { y: '2026', m: 10 }（「2026年10月払い」の表示） */
  monthParts(ym: string): { y: string; m: number } {
    return { y: ym.slice(0, 4), m: Number(ym.slice(5)) };
  }

  goMonth(month: string): void {
    const officeId = this.context.current()?.id;
    if (officeId && month !== this.month()) {
      this.router.navigate(['/o', officeId, 'payrolls', month], { queryParamsHandling: 'preserve' });
    }
  }

  /** この月に払う給与から控除する保険料の月（11/16） */
  readonly premiumMonth = computed(() => {
    const office = this.context.current();
    return office && this.month()
      ? premiumMonthOfPay(this.month(), payrollOf(office), office.deductionHistory)
      : this.month();
  });
  /** この月に払う給与から控除する保険料の月の数（控除の時期を切り替えた月は 0 か 2。11/20） */
  readonly premiumCount = computed(() => {
    const office = this.context.current();
    return office && this.month() ? premiumMonthsOfPay(this.month(), payrollOf(office), office.deductionHistory).length : 1;
  });
  readonly monthNum = (ym: string) => Number(ym.slice(5, 7));

  readonly prevMonth = computed(() => (this.month() ? shiftMonth(this.month(), -1) : ''));
  readonly nextMonth = computed(() => (this.month() ? shiftMonth(this.month(), 1) : ''));
  readonly isFuture = computed(() => {
    const office = this.context.current();
    return !!office && this.month() > latestPaidMonth(todayLocal(), payrollOf(office));
  });

  private employees: Employee[] | null = null;

  // ===== 現物給与の計算（内訳の中の「価額表で計算」から） =====
  readonly inKindFor = signal<ViewRow | null>(null);
  /** 開いている人が、その月の末日に派遣の契約か（派遣元＝事業所の都道府県で計算する。現物給与 Q&A Q6） */
  readonly inKindDispatched = signal(false);
  private readonly contractsApi = inject(ContractService);

  openInKind(v: ViewRow): void {
    this.inKindDispatched.set(false);
    this.inKindFor.set(v);
    const officeId = this.context.current()?.id;
    if (!officeId) return;
    const monthEnd = `${this.month()}-${String(daysInMonth(this.month())).padStart(2, '0')}`;
    this.contractsApi
      .list(officeId, v.employee.id)
      .then((list) => {
        if (this.inKindFor() === v) this.inKindDispatched.set(contractAt(list, monthEnd)?.dispatch === 'dispatch');
      })
      .catch(() => undefined); // 読めなくても計算はできる（都道府県を選べるまま）
  }

  /** 計算した額を現物の欄に入れる（保存は内訳の「保存して次の人へ」で、ほかの欄と一緒に） */
  applyInKind(v: ViewRow, yen: number): void {
    v.form.controls.inKindMerged.setValue(false);
    v.form.controls.inKind.setValue(String(yen));
    v.form.markAsDirty();
    this.inKindFor.set(null);
  }

  // ===== 探す・絞る・並べる・ページ（1000人を縦に並べない。11/12） =====
  readonly listOptions = signal<PersonListOptions>(defaultListOptions());
  readonly page = signal(1);
  /** 従業員ごとの契約（雇用形態・給与の形で絞る・日数の候補に使う。覚えておいた分は読まない） */
  readonly contracts = signal<ReadonlyMap<string, ContractDoc[]>>(new Map());

  /** その期間の終わりに効いている契約 */
  contractOf(v: ViewRow): ContractDoc | null {
    const end = this.period()?.end;
    const list = this.contracts().get(v.employee.id);
    return end && list ? contractAt(list, end) : null;
  }

  readonly filtered = computed(() =>
    filterAndSort(
      this.views(),
      this.listOptions(),
      (v) => v.employee,
      (v) => this.contractOf(v),
      (v) => !!v.row.saved,
      {
        dept: (v) => this.deptName(v.employee) ?? '',
        // 雇用形態は選択肢の順（正社員 → 契約社員 → …）。1文字目で比べられるよう番号にする
        employment: (v) => {
          const t = this.contractOf(v)?.employmentType;
          return t ? String(EMPLOYMENT_TYPES.indexOf(t)) : '';
        },
      },
    ),
  );

  /** 部署の名前（なし ＝ null） */
  deptName(e: Employee): string | null {
    const id = e.org?.departmentId;
    return id ? (this.context.current()?.departments?.find((d) => d.id === id)?.name ?? null) : null;
  }
  readonly shown = computed(() => pageOf(this.filtered(), this.page(), this.listOptions().size));

  private async loadContracts(officeId: string, employees: readonly Employee[]): Promise<void> {
    try {
      const lists = await Promise.all(employees.map((e) => this.contractsApi.list(officeId, e.id)));
      this.contracts.set(new Map(employees.map((e, i) => [e.id, lists[i]])));
    } catch (err) {
      console.error(err); // 読めなくても入力はできる（絞り込みと日数の候補が出ないだけ）
    }
  }

  constructor() {
    this.route.paramMap
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((p) => this.load(p.get('month') ?? ''));
  }

  private async load(month: string): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    this.loading.set(true);
    this.errorKey.set(null);
    this.savedCount.set(null);
    this.rowErrors.set(new Map());
    this.openId.set(null);
    this.prevLines.set(new Map());
    this.savedByMonth.set(null);
    if (!MONTH_RE.test(month)) {
      this.errorKey.set('payroll.error.badMonth');
      this.loading.set(false);
      return;
    }
    this.month.set(month);
    this.inKindFor.set(null);
    try {
      // 前の12か月の索引は、表を出すのを待たずに読む（本来の月の知らせにだけ使う）
      const prev12 = Array.from({ length: 12 }, (_, i) => shiftMonth(month, -(i + 1)));
      this.payrollApi
        .savedIdsByMonth(office.id, prev12, this.context.isAdmin())
        .then((m) => {
          if (this.month() === month) this.savedByMonth.set(m);
        })
        .catch((err) => console.error(err));
      this.employees ??= await this.employeesApi.list(office.id);
      const employees = this.employees;
      const period = periodOf(month, payrollOf(office));
      const saved = await this.payrollApi.month(
        office.id,
        employees.map((e) => e.id),
        month,
      );
      const byId = new Map(employees.map((e) => [e.id, e]));
      const views = payrollRows(employees, period, saved).map((row) => this.viewOf(byId.get(row.employeeId)!, row));
      this.period.set(period);
      this.views.set(views);
      this.page.set(1);
      void this.loadContracts(office.id, employees);
      this.itemsApi
        .list(office.id)
        .then((items) => this.items.set(items))
        .catch((err) => console.error(err)); // 読めなくても、よくある名前の分類で入力できる
      this.itemsApi
        .template(office.id)
        .then((t) => this.template.set(t))
        .catch((err) => console.error(err)); // 読めなくても、アプリの例を並べる
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'payroll.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  private viewOf(employee: Employee, row: PayrollRow): ViewRow {
    const form = this.buildForm(textOf(row.saved));
    if (!this.context.isAdmin()) form.disable();
    const lines = row.saved?.lines ? toDrafts(row.saved.lines) : null;
    return { employee, row, form, lines: signal(lines) };
  }

  private buildForm(t: PayrollRowText): PayrollRowForm {
    return this.fb.group({
      cash: t.cash,
      fixed: t.fixed,
      inKind: t.inKind,
      inKindMerged: t.inKindMerged,
      retro: t.retro,
      days: t.days,
      absentDays: t.absentDays,
      hours: t.hours,
      prorated: t.prorated,
      state: this.fb.control<PayrollState>(t.state),
    });
  }

  // ===== 一覧の表示 =====

  /** 金額の表示（空・読めなければ「—」） */
  yenOf(text: string): string {
    const t = toHalfWidth(text).replace(/[,，\s]/g, '');
    return /^\d+$/.test(t) ? Number(t).toLocaleString('ja-JP') : '—';
  }

  /** 固定的賃金（払った額。内訳があれば内訳から計算した値が欄に入っている） */
  fixedText(v: ViewRow): string {
    return this.yenOf(v.form.controls.fixed.value);
  }

  status(v: ViewRow): RowStatus {
    const drafts = v.lines() ?? [];
    // 金額を入れた行だけ見る（金額が空のひな形の行は保存しないので、分類が決まっていなくてよい）
    if (drafts.some((d) => d.amount.trim() && !d.category && categoryOf(d.name, this.items()) === null)) return 'unclassified';
    if (v.form.dirty) return 'edited';
    return v.row.saved ? 'saved' : 'notSaved';
  }

  /** この月の全員の合計（絞り込みに関係なく。見出しの右に出す。11/20） */
  allSums() {
    return sumPayrolls(this.views().map((v) => this.sumText(v)));
  }

  /** 絞り込んだ人全員の合計（ページをまたいで数える。入力中の値も入る。11/20） */
  sums() {
    return sumPayrolls(this.filtered().map((v) => this.sumText(v)));
  }

  private sumText(v: ViewRow) {
    return { cash: v.form.controls.cash.value, fixed: v.form.controls.fixed.value, inKind: v.form.controls.inKind.value };
  }

  yenText(n: number): string {
    return n.toLocaleString('ja-JP');
  }

  // ===== 内訳を開く・閉じる =====

  toggleOpen(v: ViewRow): void {
    if (this.openId() === v.employee.id) {
      this.openId.set(null);
      return;
    }
    this.open(v);
  }

  private open(v: ViewRow): void {
    this.inKindFor.set(null);
    this.openId.set(v.employee.id);
    // まだ何も入っていない月は、内訳から入れ始める：事業所のひな形（なければアプリの例）を並べ、
    // 前の月の内訳が読めたら、金額を入れる前ならその人の前の月の項目名に置き換える
    if (!v.row.saved && v.lines() === null && this.context.isAdmin()) {
      v.lines.set(startDrafts(null, this.template(), this.items()));
    }
    void this.loadPrev(v).then(() => {
      const prev = this.prevLinesOf(v);
      // 内訳のない月（新しい月・前のデータ）で、まだ金額を入れていなければ、その人の前の月の並びにする
      if (!v.row.saved?.lines && prev && prev.length > 0 && v.lines() !== null && !hasAmounts(v.lines())) {
        v.lines.set(copyNames(prev));
      }
    });
    setTimeout(() => {
      document.querySelector(`tr[data-row="${v.employee.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }

  /** 前の月の内訳を読む（項目名を写すため。読めなくても入力はできる） */
  private async loadPrev(v: ViewRow): Promise<void> {
    const officeId = this.context.current()?.id;
    const id = v.employee.id;
    if (!officeId || this.prevLines().has(id)) return;
    try {
      const prev = await this.payrollApi.month(officeId, [id], this.prevMonth());
      const lines = prev.get(id)?.lines ?? null;
      this.prevLines.set(new Map([...this.prevLines(), [id, lines]]));
    } catch (err) {
      console.error(err);
    }
  }

  prevLinesOf(v: ViewRow): PayrollLine[] | null {
    return this.prevLines().get(v.employee.id) ?? null;
  }


  /** 今の項目名の並びを、事業所のひな形にする（内訳の「この並びを事業所のひな形にする」） */
  async saveTemplate(names: string[]): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId || !this.context.isAdmin()) return;
    try {
      await this.itemsApi.saveTemplate(officeId, names);
      this.template.set(names);
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'payroll.error.save'));
    }
  }

  /** 絞り込んだ順で次の人（いなければ null） */
  nextOf(v: ViewRow): ViewRow | null {
    const list = this.filtered();
    const i = list.indexOf(v);
    return i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  }

  /**
   * 支払基礎日数の候補（11/12：給与の形で分ける）
   * - 月給・日給月給：在籍していた暦日数 − 欠勤日数
   * - 時給・日給：候補は出さない（実際に働いた日数 ＋ 有給の日数を入れる）。契約が分からないときも出さない
   */
  candidate(v: ViewRow): number | null {
    const pay = this.contractOf(v)?.payType;
    if (pay !== 'monthly' && pay !== 'dailyMonthly') return null;
    return candidateDays(v.row.suggestedDays, v.form.controls.absentDays.value);
  }

  fillCandidate(v: ViewRow): void {
    const c = this.candidate(v);
    if (c !== null) {
      v.form.controls.days.setValue(String(c));
      v.form.markAsDirty();
    }
  }

  // ===== 支払基礎日数をまとめて入れる（見出しの窓。絞り込んだ人全員、ページをまたいで。11/13） =====
  readonly bulkOpen = signal(false);
  readonly bulkDays = signal('');
  /** 空欄の人だけに入れる（初期値。入れた値を上書きしないように） */
  readonly bulkEmptyOnly = signal(true);
  private readonly bulkWrap = viewChild<ElementRef<HTMLElement>>('bulkWrap');

  readonly bulkDaysOk = computed(() => {
    const t = this.bulkDays().normalize('NFKC').trim();
    return /^\d{1,2}$/.test(t) && Number(t) <= this.periodDays();
  });

  toggleBulk(): void {
    this.bulkOpen.update((v) => !v);
  }

  private bulkTargets(): ViewRow[] {
    return this.filtered().filter((v) => !this.bulkEmptyOnly() || v.form.controls.days.value.trim() === '');
  }

  /** 同じ日数を入れる（例：正社員で絞って 30） */
  applyBulkDays(): void {
    if (!this.bulkDaysOk()) return;
    const d = String(Number(this.bulkDays().normalize('NFKC').trim()));
    for (const v of this.bulkTargets()) {
      v.form.controls.days.setValue(d);
      v.form.markAsDirty();
    }
    this.bulkOpen.set(false);
  }

  /** 月給・日給月給の人に、候補（在籍した暦日数 − 欠勤日数）を入れる。時給・日給の人には入れない */
  applyBulkCandidate(): void {
    for (const v of this.bulkTargets()) this.fillCandidate(v);
    this.bulkOpen.set(false);
  }

  onDocumentClick(event: MouseEvent): void {
    const el = this.bulkWrap()?.nativeElement;
    if (this.bulkOpen() && el && !el.contains(event.target as Node)) this.bulkOpen.set(false);
  }

  // ===== 保存 =====

  /** 1人分を読む（直していなければ null ＝ 変更なし） */
  private changeOf(v: ViewRow): { change: PayrollChange | null; errors: RowError[] } {
    const r = readEntry(v.form.getRawValue(), v.lines(), this.contractOf(v)?.payType ?? null, this.periodDays());
    const id = v.employee.id;
    if (r.kind === 'blank') {
      return { change: v.row.saved ? { employeeId: id, input: null, exists: true, before: v.row.saved } : null, errors: [] };
    }
    if (r.kind === 'invalid') return { change: null, errors: r.errors };
    if (v.row.saved && sameInput(r.input, v.row.saved)) return { change: null, errors: [] };
    return { change: { employeeId: id, input: r.input, exists: !!v.row.saved, before: v.row.saved ?? null }, errors: [] };
  }

  /** 内訳で分類を選んだ、まだ分類の決まっていない項目名（保存のときに「給与の項目と分類」に登録する） */
  private newItems(changes: readonly PayrollChange[]): PayrollItemInput[] {
    const out: PayrollItemInput[] = [];
    for (const c of changes) {
      for (const l of c.input?.lines ?? []) {
        if (categoryOf(l.name, [...this.items(), ...out]) === null) out.push({ name: l.name, labels: [], category: l.category });
      }
    }
    return out;
  }

  private async write(changes: PayrollChange[]): Promise<void> {
    const office = this.context.current()!;
    const created = this.newItems(changes);
    for (const it of created) await this.itemsApi.create(office.id, it);
    if (created.length > 0) this.items.set(await this.itemsApi.list(office.id));
    await this.payrollApi.saveMonth(office.id, this.month(), changes);
  }

  /** 保存した人の行を、その場で保存済みにする（一覧を読み直さない。開いている位置を保つ） */
  private markSaved(changes: readonly PayrollChange[]): void {
    const byId = new Map(changes.map((c) => [c.employeeId, c]));
    this.views.set(
      this.views().map((v) => {
        const c = byId.get(v.employee.id);
        if (!c) return v;
        const saved: Payroll | null = c.input
          ? { ...c.input, officeId: this.context.current()!.id, employeeId: v.employee.id, paidMonth: this.month() }
          : null;
        return this.viewOf(v.employee, { ...v.row, saved });
      }),
    );
  }

  /** 内訳の「保存して次の人へ」：その人だけ保存して、絞り込んだ順で次の人を開く */
  async saveOne(v: ViewRow): Promise<void> {
    if (!this.context.current() || !this.context.isAdmin() || this.saving()) return;
    this.savedCount.set(null);
    this.errorKey.set(null);
    const { change, errors } = this.changeOf(v);
    const rowErrors = new Map(this.rowErrors());
    if (errors.length > 0) {
      rowErrors.set(v.employee.id, errors);
      this.rowErrors.set(rowErrors);
      return;
    }
    rowErrors.delete(v.employee.id);
    this.rowErrors.set(rowErrors);
    const next = this.nextOf(v);
    this.saving.set(true);
    try {
      if (change) {
        await this.write([change]);
        this.markSaved([change]);
      } else {
        v.form.markAsPristine();
      }
      if (next) {
        const fresh = this.views().find((x) => x.employee.id === next.employee.id) ?? next;
        const idx = this.filtered().indexOf(fresh);
        if (idx >= 0) this.page.set(Math.floor(idx / this.listOptions().size) + 1);
        this.open(fresh);
      } else {
        this.openId.set(null);
      }
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'payroll.error.save'));
    } finally {
      this.saving.set(false);
    }
  }

  /** 下の帯の「保存する」：直した行をまとめて保存する（支払基礎日数をまとめて入れたときなど） */
  async save(): Promise<void> {
    if (!this.context.current() || !this.context.isAdmin() || this.saving()) return;
    this.savedCount.set(null);
    this.errorKey.set(null);

    const changes: PayrollChange[] = [];
    const errors = new Map<string, RowError[]>();
    for (const v of this.views()) {
      if (!v.form.dirty) continue;
      const r = this.changeOf(v);
      if (r.errors.length > 0) errors.set(v.employee.id, r.errors);
      else if (r.change) changes.push(r.change);
    }
    this.rowErrors.set(errors);
    if (errors.size > 0) {
      // 1行でもおかしければ何も保存しない（どこまで保存されたか迷わないように）
      this.errorKey.set('payroll.error.rows');
      return;
    }

    this.saving.set(true);
    try {
      await this.write(changes);
      await this.load(this.month());
      this.savedCount.set(changes.length);
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'payroll.error.save'));
    } finally {
      this.saving.set(false);
    }
  }

  /** '2026-10-01' → '10/1' */
  readonly md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}
