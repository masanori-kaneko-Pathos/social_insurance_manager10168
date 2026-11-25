import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { Employee } from '../../../../core/models/employee';
import { Payroll, PayrollState } from '../../../../core/models/payroll';
import { PayrollItem, PayrollItemInput } from '../../../../core/models/payroll-item';
import { ContractDoc, PayType } from '../../../../core/models/contract';
import { ContractService } from '../../../employees/contract.service';
import { contractAt } from '../../../employees/logic/contract-form-model';
import { PayrollItemService } from '../../payroll-item.service';
import { categoryOf, hasAmounts, LineDraft, startDrafts, toDrafts } from '../../logic/payroll-lines';
import { PayrollEntry, PayrollRowForm } from '../payroll-entry/payroll-entry';
import { ToastService } from '../../../../shared/services/toast.service';
import { daysInclusive, shiftMonth, todayLocal } from '../../../../shared/utils/date';
import { candidateDays, PayrollRowText, readEntry, RowError, sameInput, textOf } from '../../logic/payroll-input';
import { OfficeContext } from '../../../office/office-context.service';
import { formatHours } from '../../../../shared/utils/number';
import { employedDuring, latestPaidMonth, periodOf, suggestDays } from '../../logic/payroll-rows';
import { payrollOf } from '../../../office/office-settings';
import { PayrollService } from '../../payroll.service';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { payrollAt } from '../../../office/logic/pay-group';

/**
 * 従業員の詳細：給与の実績（直近12件）
 * 管理者は、この人の1か月分をここで入れる・直すこともできる（チェックは月の画面と同じ payroll-input.ts）
 */
@Component({
  selector: 'app-payroll-card',
  imports: [PayrollEntry, RouterLink, TranslocoPipe],
  templateUrl: './payroll-card.html',
  styleUrl: './payroll-card.css',
})
export class PayrollCard {
  private readonly api = inject(PayrollService);
  readonly context = inject(OfficeContext);

  readonly employee = input.required<Employee>();

  private readonly toast = inject(ToastService);
  /** この人の全部（新しい順）。入力の窓で、選んだ月の保存済みを探すのに使う */
  private readonly all = signal<Payroll[]>([]);
  /** 実績が入っている支払月（内訳の「本来の月」に実績があるかを知らせる。11/24） */
  readonly savedMonths = computed(() => new Set(this.all().map((p) => p.paidMonth)));
  readonly items = computed(() => this.all().slice(0, 12));
  /** 並び：新しい順（初期値）か古い順。画面の中だけ（保存しない） */
  readonly newestFirst = signal(true);
  readonly shown = computed(() => (this.newestFirst() ? this.items() : [...this.items()].reverse()));
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);

  constructor() {
    effect(() => {
      const e = this.employee();
      this.load(e.id);
    });
  }

  private async load(employeeId: string): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    this.loading.set(true);
    try {
      this.all.set(await this.api.listOfEmployee(office.id, employeeId));
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'payroll.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  periodText(p: Payroll): string {
    const office = this.context.current();
    if (!office) return '';
    // 対象期間は、その人のその月の給与の支払区分で出す（11/24）
    const { start, end } = periodOf(p.paidMonth, payrollAt(office, this.employee(), p.paidMonth));
    const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    return `${md(start)}〜${md(end)}`;
  }

  // ===== 1か月分の入力（管理者だけ。月の画面の「内訳」と同じ部品 app-payroll-entry。11/24） =====

  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly itemsApi = inject(PayrollItemService);
  private readonly contractsApi = inject(ContractService);
  /** 入力している月（null は閉じている） */
  readonly editMonth = signal<string | null>(null);
  form: PayrollRowForm = this.buildForm(textOf(null));
  readonly lines = signal<LineDraft[] | null>(null);
  readonly payrollItems = signal<PayrollItem[]>([]);
  /** 事業所の内訳のひな形（null ＝ まだない：アプリの例を並べる） */
  readonly template = signal<string[] | null>(null);
  private readonly contracts = signal<ContractDoc[]>([]);
  readonly errors = signal<RowError[]>([]);
  readonly saving = signal(false);
  readonly saveError = signal(false);

  private readonly savedOf = (month: string) => this.all().find((p) => p.paidMonth === month) ?? null;
  readonly editingSaved = computed(() => {
    const m = this.editMonth();
    return m ? this.savedOf(m) : null;
  });
  readonly editPeriod = computed(() => {
    const m = this.editMonth();
    const office = this.context.current();
    return m && office ? periodOf(m, payrollAt(office, this.employee(), m)) : null;
  });
  readonly editPeriodDays = computed(() => {
    const p = this.editPeriod();
    return p ? daysInclusive(p.start, p.end) : 0;
  });
  /** 対象期間に在籍していない月（入れられるが、知らせる） */
  readonly notEmployed = computed(() => {
    const p = this.editPeriod();
    return !!p && !employedDuring(this.employee(), p);
  });
  /** 期間の終わりの給与の形（基本給を固定的賃金に数えるか・日数の候補を出すか） */
  readonly payType = computed<PayType | null>(() => {
    const p = this.editPeriod();
    return p ? (contractAt(this.contracts(), p.end)?.payType ?? null) : null;
  });
  /** 日数の候補（月給：暦日数／日給月給：欠勤があれば所定労働日数 − 欠勤日数。日給・時給は出さない。11/25） */
  candidate(): number | null {
    const p = this.editPeriod();
    const t = this.payType();
    if (!p || (t !== 'monthly' && t !== 'dailyMonthly')) return null;
    const scheduled = contractAt(this.contracts(), p.end)?.monthlyDays ?? null;
    return candidateDays(suggestDays(this.employee(), p), this.form.controls.absentDays.value, t, scheduled);
  }
  /** 前の月の内訳（項目名を写す） */
  private prevLinesOf(month: string) {
    return this.savedOf(shiftMonth(month, -1))?.lines ?? null;
  }
  readonly prevLines = computed(() => {
    const m = this.editMonth();
    return m ? this.prevLinesOf(m) : null;
  });

  /** 今の項目名の並びを、事業所のひな形にする */
  async saveTemplate(names: string[]): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    try {
      await this.itemsApi.saveTemplate(office.id, names);
      this.template.set(names);
    } catch (err) {
      console.error(err);
      this.saveError.set(true);
    }
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

  /** 開く：月を渡さなければ、支払日を過ぎた最新の月 */
  open(month?: string): void {
    const office = this.context.current();
    if (!office) return;
    this.startEdit(month ?? latestPaidMonth(todayLocal(), payrollOf(office)));
    // 給与の項目・契約（読めなくても入力はできる）
    this.itemsApi.list(office.id).then((x) => this.payrollItems.set(x)).catch((err) => console.error(err));
    this.itemsApi
      .template(office.id)
      .then((t) => {
        this.template.set(t);
        // ひな形が読めたら、まだ金額を入れていない新しい月の行を並べ直す
        if (this.editMonth() && !this.editingSaved()?.lines && !hasAmounts(this.lines())) {
          this.lines.set(startDrafts(this.prevLines(), t, this.payrollItems()));
        }
      })
      .catch((err) => console.error(err));
    this.contractsApi.list(office.id, this.employee().id).then((x) => this.contracts.set(x)).catch((err) => console.error(err));
  }

  /** 月を変えたら、その月の保存済みを入れ直す（なければ内訳の1行目から） */
  startEdit(month: string): void {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const saved = this.savedOf(month);
    this.editMonth.set(month);
    this.form = this.buildForm(textOf(saved));
    // まだない月は、前の月の項目名 → 事業所のひな形 → アプリの例 を並べる
    // 内訳のある月はその行、ない月（新しい月・前のデータ）は、前の月の項目名 → 事業所の給与項目 → アプリの例 を並べる
    this.lines.set(saved?.lines ? toDrafts(saved.lines) : startDrafts(this.prevLinesOf(month), this.template(), this.payrollItems()));
    this.errors.set([]);
    this.saveError.set(false);
  }

  close(): void {
    this.editMonth.set(null);
  }

  async save(): Promise<void> {
    const office = this.context.current();
    const month = this.editMonth();
    if (!office || !month || this.saving()) return;
    const r = readEntry(this.form.getRawValue(), this.lines(), this.payType(), this.editPeriodDays());
    const before = this.editingSaved();
    if (r.kind === 'invalid') {
      this.errors.set(r.errors);
      return;
    }
    // 空のまま保存：保存済みなら消す、なければ何もしない（月の画面と同じ決まり）
    const input = r.kind === 'ok' ? r.input : null;
    if (input === null && !before) {
      this.errors.set(['cashRequired']);
      return;
    }
    if (input && before && sameInput(input, before)) {
      this.close();
      return;
    }
    this.errors.set([]);
    this.saveError.set(false);
    this.saving.set(true);
    try {
      // 内訳で分類を選んだ、まだ分類の決まっていない項目名を「給与の項目と分類」に登録する
      const known: PayrollItemInput[] = [...this.payrollItems()];
      for (const l of input?.lines ?? []) {
        if (categoryOf(l.name, known) === null) {
          const it = { name: l.name, labels: [], category: l.category };
          await this.itemsApi.create(office.id, it);
          known.push(it);
        }
      }
      await this.api.saveMonth(office.id, month, [
        { employeeId: this.employee().id, input, exists: !!before, before },
      ]);
      await this.load(this.employee().id);
      this.close();
      this.toast.show('common.saved');
    } catch (err) {
      console.error(err);
      this.saveError.set(true);
    } finally {
      this.saving.set(false);
    }
  }

  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  readonly hours = (m: number | null) => (m == null ? '—' : formatHours(m));
}
