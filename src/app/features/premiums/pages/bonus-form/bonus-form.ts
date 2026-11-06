import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { BonusPayment, BonusPaymentInput } from '../../../../core/models/bonus';
import { Employee } from '../../../../core/models/employee';
import { OfficeTotal } from '../../../../core/models/premium';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import {
  DEFAULT_PREMIUM,
  everKumiai,
  premiumOf,
  ratesForOffice,
} from '../../../office/office-settings';
import { parseYen } from '../../../rates/logic/grade';
import { formatYen } from '../../../../shared/utils/number';
import { RateTables } from '../../../rates/logic/pick-rates';
import { RateService } from '../../../rates/rate.service';
import { BonusService } from '../../bonus.service';
import {
  BonusContext,
  BonusRow,
  buildBonusRow,
  eligibleOn,
  withDraft,
} from '../../logic/bonus-rows';
import { officeTotals } from '../../logic/premium-core';
import { formatMilli } from '../../logic/rounding';

import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** 新規の支給を計算の中で区別するための仮の ID */
const NEW_ID = '__new__';
/** 入力できる賞与額の上限（打ち間違い防止） */
const MAX_BONUS = 1_000_000_000;

interface FormRow extends BonusRow {
  employee: Employee;
}

@Component({
  selector: 'app-bonus-form',
  imports: [HalfWidthDigits, RouterLink, TranslocoPipe],
  templateUrl: './bonus-form.html',
  styleUrl: './bonus-form.css',
})
export class BonusForm {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly employeesApi = inject(EmployeeService);
  private readonly bonusApi = inject(BonusService);
  private readonly rates = inject(RateService);
  readonly context = inject(OfficeContext);

  /** URL の :bonusId（null は新規） */
  readonly bonusId = this.route.snapshot.paramMap.get('bonusId');
  readonly isNew = this.bonusId === null;
  readonly readOnly = !this.context.isAdmin();

  readonly options = computed(() => {
    const office = this.context.current();
    return office ? premiumOf(office) : DEFAULT_PREMIUM;
  });

  // ===== 箱 =====
  private readonly employees = signal<Employee[]>([]);
  private readonly payments = signal<BonusPayment[]>([]);
  private readonly tables = signal<RateTables | null>(null);
  readonly loading = signal(true);
  readonly loadErrorKey = signal<string | null>(null);

  // ===== 入力（「保存する」を押すまで Firestore には書かない） =====
  readonly paidDate = signal('');
  readonly title = signal('');
  /** 従業員ID → 入力中の文字（「500,000」など） */
  readonly amountTexts = signal<Record<string, string>>({});

  readonly submitted = signal(false);
  readonly saving = signal(false);
  readonly saveErrorKey = signal<string | null>(null);
  readonly confirmDelete = signal(false);

  // ===== 入力から自動で決まる箱 =====

  readonly dateOk = computed(() => DATE.test(this.paidDate()));

  /** 読めない金額が入っている従業員 */
  readonly badAmounts = computed(() => {
    const bad = new Set<string>();
    for (const [id, text] of Object.entries(this.amountTexts())) {
      if (!text.trim()) continue;
      const n = parseYen(text);
      if (n === null || n > MAX_BONUS) bad.add(id);
    }
    return bad;
  });

  /** 保存する金額（0円・空は入れない） */
  readonly amounts = computed<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const [id, text] of Object.entries(this.amountTexts())) {
      const n = text.trim() ? parseYen(text) : null;
      if (n !== null && n > 0 && n <= MAX_BONUS) out[id] = n;
    }
    return out;
  });

  readonly peopleCount = computed(() => Object.keys(this.amounts()).length);

  /** ほかの支給と支払日が同じ（計算結果を支払日で突き合わせるので、禁止） */
  readonly duplicateDate = computed(
    () =>
      this.dateOk() &&
      this.payments().some((p) => p.id !== this.bonusId && p.paidDate === this.paidDate()),
  );

  private readonly ctx = computed<BonusContext | null>(() => {
    const tables = this.tables();
    const office = this.context.current();
    if (!tables || !office) return null;
    return { ratesFor: ratesForOffice(office, tables), options: this.options() };
  });

  /** 保存済みの支給に、入力中の内容を差し替えたもの（計算はいつもこれで行う） */
  private readonly draftPayments = computed(() =>
    withDraft(this.payments(), {
      id: this.bonusId ?? NEW_ID,
      paidDate: this.paidDate(),
      amounts: this.amounts(),
    }),
  );

  /** 表の行：支払日に対象になりうる人と、金額を入れた人（打つたびに計算し直す） */
  readonly rows = computed<FormRow[]>(() => {
    const ctx = this.ctx();
    if (!ctx || !this.dateOk()) return [];
    const date = this.paidDate();
    const texts = this.amountTexts();
    const payments = this.draftPayments();
    return this.employees()
      .filter((e) => eligibleOn(e, date) || (texts[e.id] ?? '').trim() !== '')
      .map((employee) => ({ employee, ...buildBonusRow(employee, payments, date, ctx) }));
  });

  readonly hiddenCount = computed(() =>
    this.dateOk() ? this.employees().length - this.rows().length : 0,
  );

  /** 計算できなかった人（合計に入らない） */
  readonly problemCount = computed(
    () => this.rows().filter((r) => r.state === 'missing' || r.state === 'error').length,
  );

  /** この支給の合計 */
  readonly totals = computed<OfficeTotal[]>(() =>
    officeTotals(this.rows().flatMap((r) => (r.state === 'ok' && r.result ? [r.result] : []))),
  );
  readonly grandTotalYen = computed(() => this.totals().reduce((s, t) => s + t.totalYen, 0));

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    const office = this.context.current();
    if (!office) return;
    try {
      const [employees, payments, tables] = await Promise.all([
        this.employeesApi.list(office.id),
        this.bonusApi.list(office.id),
        this.rates.tablesFor(office.id, everKumiai(office)),
      ]);
      this.employees.set(employees);
      this.payments.set(payments);
      this.tables.set(tables);

      if (this.bonusId) {
        const p = payments.find((x) => x.id === this.bonusId);
        if (!p) {
          this.loadErrorKey.set('bonus.error.notFound');
          return;
        }
        this.paidDate.set(p.paidDate);
        this.title.set(p.title ?? '');
        this.amountTexts.set(
          Object.fromEntries(Object.entries(p.amounts).map(([id, n]) => [id, formatYen(n)])),
        );
      }
    } catch (err) {
      console.error(err);
      this.loadErrorKey.set('bonus.error.load');
    } finally {
      this.loading.set(false);
    }
  }

  // ===== 入力 =====

  setAmount(employeeId: string, text: string): void {
    this.amountTexts.update((m) => ({ ...m, [employeeId]: text }));
  }

  amountText(employeeId: string): string {
    return this.amountTexts()[employeeId] ?? '';
  }

  // ===== 保存・削除 =====

  async save(): Promise<void> {
    if (this.readOnly || this.saving()) return;
    this.submitted.set(true);
    if (
      !this.dateOk() ||
      this.duplicateDate() ||
      this.badAmounts().size > 0 ||
      this.peopleCount() === 0
    ) {
      return;
    }
    const office = this.context.current();
    if (!office) return;

    const title = this.title().trim();
    const input: BonusPaymentInput = {
      paidDate: this.paidDate(),
      title: title ? title : null,
      amounts: this.amounts(),
    };

    this.saving.set(true);
    this.saveErrorKey.set(null);
    try {
      if (this.bonusId) await this.bonusApi.update(office.id, this.bonusId, input);
      else await this.bonusApi.create(office.id, input);
      await this.router.navigate(['/o', office.id, 'bonuses']);
    } catch (err) {
      console.error(err);
      this.saveErrorKey.set('bonus.error.save');
    } finally {
      this.saving.set(false);
    }
  }

  /** 1回目で確認の表示、2回目で削除 */
  async remove(): Promise<void> {
    const office = this.context.current();
    if (this.readOnly || !this.bonusId || !office) return;
    if (!this.confirmDelete()) {
      this.confirmDelete.set(true);
      return;
    }
    this.saving.set(true);
    this.saveErrorKey.set(null);
    try {
      await this.bonusApi.delete(office.id, this.bonusId);
      await this.router.navigate(['/o', office.id, 'bonuses']);
    } catch (err) {
      console.error(err);
      this.saveErrorKey.set('bonus.error.save');
    } finally {
      this.saving.set(false);
    }
  }

  // ===== 表示の小道具 =====

  missingKey(r: FormRow): string {
    if (r.state === 'error') return 'premium.error.calc';
    return `premium.missing.${r.result?.missing[0]?.reason ?? 'noRate'}`;
  }

  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  readonly milli = formatMilli;
}
