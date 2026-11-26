import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { BonusPayment } from '../../../../core/models/bonus';
import { Employee } from '../../../../core/models/employee';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import {
  everKumiai,
  premiumOf,
  insurerKeyOf,
  ratesForOffice,
} from '../../../office/office-settings';
import { RateTables } from '../../../rates/logic/pick-rates';
import { RateService } from '../../../rates/rate.service';
import { BonusService } from '../../bonus.service';
import { BonusRow, buildBonusRow, collectBonusResults } from '../../logic/bonus-rows';
import { officeTotals } from '../../logic/premium-core';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { SortHeader } from '../../../../shared/components/sort-header/sort-header';
import { EntryChoice, EntryChoiceItem } from '../../../../shared/components/entry-choice/entry-choice';
import {
  defaultListOptions,
  filterAndSort,
  PersonListOptions,
} from '../../../../shared/logic/person-list';
import { PersonName } from '../../../../shared/components/person-name/person-name';
import { DecisionNoticeCard } from '../../components/decision-notice-card/decision-notice-card';
import { todayLocal } from '../../../../shared/utils/date';
import {
  bonusFilterCount,
  BonusListFilter,
  BonusListOptions,
  BonusListSort,
  bonusRowsTotal,
  defaultBonusListOptions,
  filterBonusRows,
  ITEM_ALL,
  ITEM_LOOSE,
  itemNameOf,
  sortBonusRows,
} from '../../logic/bonus-list-view';
import { bonusTotalOf, DEFAULT_NATURE, recipientsOf } from '../../logic/bonus-nature';
import { SpecialInsuredMap, SpecialInsuredService } from '../../../employees/special-insured.service';

/** 開いた支給の、1人ずつの行 */
interface PersonRow {
  employee: Employee;
  amount: number;
  row: BonusRow;
}

interface ListRow {
  payment: BonusPayment;
  people: number;
  amountYen: number; // 賞与額の合計（11/16）
  totalYen: number; // 納付額（健保・厚年・拠出金の合計）
  problems: number;
}

@Component({
  selector: 'app-bonus-list',
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'filterOpen.set(false)',
  },
  imports: [DecisionNoticeCard, EntryChoice, PersonName, RouterLink, SortHeader, TranslocoPipe],
  templateUrl: './bonus-list.html',
  styleUrl: './bonus-list.css',
})
export class BonusList {
  private readonly employeesApi = inject(EmployeeService);
  private readonly bonusApi = inject(BonusService);
  private readonly rates = inject(RateService);
  readonly context = inject(OfficeContext);

  /** 登録の入り口：1件ずつ／ファイルから（11/26） */
  readonly entryItems = computed<EntryChoiceItem[]>(() => {
    const id = this.context.current()?.id;
    return [
      { icon: 'plus', titleKey: 'bonus.entry.one.title', noteKey: 'bonus.entry.one.note', link: ['/o', id, 'bonuses', 'new'] },
      {
        icon: 'download',
        titleKey: 'bonus.entry.file.title',
        noteKey: 'bonus.entry.file.note',
        link: ['/o', id, 'import'],
        queryParams: { kind: 'bonuses', from: 'bonuses' },
      },
    ];
  });
  private readonly transloco = inject(TranslocoService);

  /** 支払予定月の表示（「7月・12月」。11/20） */
  monthsText(months: readonly number[]): string {
    const sep = this.transloco.getActiveLang() === 'en' ? ', ' : '・';
    return [...months].sort((a, b) => a - b).map((m) => this.transloco.translate('bonus.monthOf', { m })).join(sep);
  }

  private readonly employees = signal<Employee[]>([]);
  private readonly payments = signal<BonusPayment[]>([]);
  private readonly tables = signal<RateTables | null>(null);
  readonly loading = signal(true);
  readonly errorKey = signal<string | null>(null);

  /** 特定被保険者（組合健保）：従業員ID → 「月 → 特定被保険者か」。制度を使っていなければ空（11/26） */
  private readonly special = signal<SpecialInsuredMap>(new Map());
  private readonly specialApi = inject(SpecialInsuredService);

  /** 1回の支給を1行に（新しい順） */
  readonly rows = computed<ListRow[]>(() => {
    const tables = this.tables();
    const office = this.context.current();
    if (!tables || !office) return [];
    const special = this.special();
    const ctx = {
      ratesFor: ratesForOffice(office, tables),
      insurerOf: insurerKeyOf(office),
      options: premiumOf(office),
      specialInsuredOf: (id: string) => special.get(id),
    };
    const payments = this.payments();
    return payments.map((payment) => {
      const c = collectBonusResults(this.employees(), payments, ctx, (d) => d === payment.paidDate);
      return {
        payment,
        // 通貨＋現物（11/20）
        people: recipientsOf(payment).length,
        amountYen: recipientsOf(payment).reduce((s, id) => s + bonusTotalOf(payment, id), 0),
        totalYen: officeTotals(c.results).reduce((s, t) => s + t.totalYen, 0),
        problems: c.problemCount,
      };
    });
  });

  // ===== 絞り込み・並べ替え・合計（11/19） =====
  readonly options = signal<BonusListOptions>(defaultBonusListOptions());
  readonly filterOpen = signal(false);
  private readonly filterWrap = viewChild<ElementRef<HTMLElement>>('filterWrap');
  readonly itemAll = ITEM_ALL;
  readonly itemLoose = ITEM_LOOSE;
  readonly defaultNature = DEFAULT_NATURE;
  readonly filterCount = computed(() => bonusFilterCount(this.options().filter));
  /** 絞り込みの「賞与の項目」の選択肢：支給に出てくる項目の名前 */
  readonly itemNames = computed(() =>
    [...new Set(this.payments().flatMap((p) => (p.group ? [p.group] : [])))].sort((a, b) =>
      a.localeCompare(b, 'ja'),
    ),
  );
  /** 未分類の賞与（支給に出てくるが、どの項目にも入っていない。一覧の上で知らせる） */
  readonly looseNames = computed(() => [
    ...new Set(
      this.payments()
        .filter((p) => !p.group)
        .map((p) => p.nature?.trim() || DEFAULT_NATURE),
    ),
  ]);
  readonly shownRows = computed(() => {
    const o = this.options();
    return sortBonusRows(filterBonusRows(this.rows(), o.filter, DEFAULT_NATURE), o.sort, o.dir);
  });
  readonly total = computed(() => bonusRowsTotal(this.shownRows()));
  /** 決定の通知の初めの月：いちばん新しい支給の月（11/19） */
  readonly noticeMonth = computed(() => this.payments()[0]?.paidDate.slice(0, 7) ?? todayLocal().slice(0, 7));

  itemOf(r: ListRow): string {
    return itemNameOf(r.payment, DEFAULT_NATURE);
  }

  setFilter(patch: Partial<BonusListFilter>): void {
    this.options.update((o) => ({ ...o, filter: { ...o.filter, ...patch } }));
  }

  clearFilter(): void {
    this.options.update((o) => ({ ...o, filter: defaultBonusListOptions().filter }));
  }

  /** 見出しを押す：同じ列なら向きを変える。初めての列は、支払日・数は大きい順、名称は五十音順から */
  sortBy(key: BonusListSort): void {
    this.options.update((o) =>
      o.sort === key
        ? { ...o, dir: o.dir === 'asc' ? 'desc' : 'asc' }
        : { ...o, sort: key, dir: key === 'title' ? 'asc' : 'desc' },
    );
  }

  arrow(key: BonusListSort): string {
    const o = this.options();
    return o.sort === key ? (o.dir === 'asc' ? '▲' : '▼') : '';
  }

  onDocumentClick(e: MouseEvent): void {
    const wrap = this.filterWrap()?.nativeElement;
    if (this.filterOpen() && wrap && !wrap.contains(e.target as Node)) this.filterOpen.set(false);
  }

  /** 1人ずつの額を開いている支給（1つだけ開く） */
  readonly openId = signal<string | null>(null);

  /** 1人ずつの表の並び（ほかの人の並ぶ表と同じ見出し。初期値は社員番号の順。11/16） */
  readonly peopleOptions = signal<PersonListOptions>(defaultListOptions());

  /** 開いた支給の1人ずつの行（開いたときだけ計算する） */
  readonly people = computed<PersonRow[]>(() => {
    const id = this.openId();
    const tables = this.tables();
    const office = this.context.current();
    const payments = this.payments();
    const payment = payments.find((p) => p.id === id);
    if (!payment || !tables || !office) return [];
    const special = this.special();
    const ctx = {
      ratesFor: ratesForOffice(office, tables),
      insurerOf: insurerKeyOf(office),
      options: premiumOf(office),
      specialInsuredOf: (id: string) => special.get(id),
    };
    const list = this.employees().filter((e) => bonusTotalOf(payment, e.id) > 0);
    return filterAndSort(
      list,
      this.peopleOptions(),
      (e) => e,
      () => null,
      () => false,
    ).map((employee) => ({
      employee,
      amount: bonusTotalOf(payment, employee.id),
      row: buildBonusRow(employee, payments, payment.paidDate, ctx),
    }));
  });

  /** 開いた支給の合計（賞与額・標準賞与額・本人負担。11/16） */
  readonly peopleTotals = computed(() => {
    let amount = 0;
    let standard = 0;
    let employee = 0;
    for (const p of this.people()) {
      amount += p.amount;
      if (p.row.result) standard += p.row.result.standardBonus;
      if (p.row.state === 'ok') employee += p.row.result!.employeeYen;
    }
    return { amount, standard, employee };
  });

  toggle(id: string): void {
    this.openId.update((cur) => (cur === id ? null : id));
  }

  nameOf(e: Employee): string {
    return `${e.lastName} ${e.firstName}`.trim();
  }

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
      this.special.set(await this.specialApi.forEmployees(office.id, office, employees));
      this.employees.set(employees);
      this.payments.set(payments);
      this.tables.set(tables);
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'bonus.error.load'));
    } finally {
      this.loading.set(false);
    }
  }

  readonly yen = (n: number) => n.toLocaleString('ja-JP');
}
