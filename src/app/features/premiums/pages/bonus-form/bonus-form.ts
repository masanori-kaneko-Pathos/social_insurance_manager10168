import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { downloadCsv, safeFileName } from '../../../../shared/csv/csv';
import { bonusExportTable } from '../../logic/bonus-export';
import { BONUS_DEFAULT_KEYS, BonusExportItem, bonusExportColumns, bonusExportItems } from '../../logic/bonus-export-columns';
import { ExportDialog } from '../../../../shared/components/export-dialog/export-dialog';
import { CloseOnOutside } from '../../../../shared/directives/close-on-outside';
import { BonusPayment, BonusPaymentInput } from '../../../../core/models/bonus';
import { Employee } from '../../../../core/models/employee';
import { OfficeTotal } from '../../../../core/models/premium';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import {
  DEFAULT_PREMIUM,
  everKumiai,
  premiumOf,
  insurerKeyOf, ratesForOffice,
} from '../../../office/office-settings';
import { parseYen } from '../../../rates/logic/grade';
import { formatYen } from '../../../../shared/utils/number';
import { ColumnMapper } from '../../../../shared/components/column-mapper/column-mapper';
import { IMPORT_ACCEPT, ImportFileError, readTables, SheetTable } from '../../../../shared/import/parse';
import { BONUS_IMPORT_SPEC, BonusImportResult, matchBonusRows } from '../../logic/bonus-import';
import { RateTables } from '../../../rates/logic/pick-rates';
import { RateService } from '../../../rates/rate.service';
import { BonusService } from '../../bonus.service';
import { BONUS_COUNT_AS, BonusCountAs, DEFAULT_NATURE, natureOf, periodYearOf } from '../../logic/bonus-nature';
import { resolveItems, treatmentAt } from '../../logic/bonus-items';
import { todayLocal } from '../../../../shared/utils/date';
import { BonusItemService } from '../../bonus-item.service';
import type { BonusItem, BonusTreatment } from '../../../../core/models/bonus-item';
import { isOver70Employee } from '../../../employees/logic/coverage';
import {
  BonusContext,
  BonusRow,
  buildBonusRow,
  eligibleOn,
  withDraft,
} from '../../logic/bonus-rows';
import { officeTotals } from '../../logic/premium-core';
import { formatMilli } from '../../logic/rounding';

import { PremiumBreakdown } from '../../components/premium-breakdown/premium-breakdown';
import { PremiumTotals } from '../../components/premium-totals/premium-totals';
import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
import { EnterNext } from '../../../../shared/directives/enter-next';
import { PersonListBar } from '../../../../shared/components/person-list-bar/person-list-bar';
import { Pager } from '../../../../shared/components/pager/pager';
import { SortHeader } from '../../../../shared/components/sort-header/sort-header';
import { defaultListOptions, filterAndSort, pageOf, PersonListOptions } from '../../../../shared/logic/person-list';
import { ContractDoc } from '../../../../core/models/contract';
import { ContractService } from '../../../employees/contract.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { contractAt } from '../../../employees/logic/contract-form-model';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { watchUnsaved } from '../../../../shared/services/unsaved-changes';
import { PersonName } from '../../../../shared/components/person-name/person-name';
import { BackLink } from '../../../../shared/components/back-link/back-link';
import { SpecialInsuredMap, SpecialInsuredService } from '../../../employees/special-insured.service';
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** 新規の支給を計算の中で区別するための仮の ID */
const NEW_ID = '__new__';
/** 入力できる賞与額の上限（打ち間違い防止） */
const MAX_BONUS = 1_000_000_000;

interface FormRow extends BonusRow {
  employee: Employee;
}

/** 取り込んだファイルの支払日についての知らせ（11/16） */
interface DateNote {
  key: string;
  params: Record<string, string>;
  warn: boolean;
}

@Component({
  selector: 'app-bonus-form',
  imports: [BackLink, PersonName, CloseOnOutside, ColumnMapper, EnterNext, ExportDialog, HalfWidthDigits, Pager, PersonListBar, PremiumBreakdown, PremiumTotals, RouterLink, SortHeader, TranslocoPipe],
  templateUrl: './bonus-form.html',
  styleUrl: './bonus-form.css',
})
export class BonusForm {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly employeesApi = inject(EmployeeService);
  private readonly bonusApi = inject(BonusService);
  private readonly itemsApi = inject(BonusItemService);
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
  /** 性質（年4回以上かを数えるまとまり。空は「賞与」）と回数の数え方（11/19。bonus-nature.ts） */
  readonly nature = signal('');
  readonly countAs = signal<BonusCountAs>('normal');
  readonly countAsList = BONUS_COUNT_AS;
  readonly defaultNature = DEFAULT_NATURE;
  /** 賞与の項目（11/19） */
  readonly items = signal<BonusItem[]>([]);
  /** 入力の候補：賞与の項目の名前と、ほかの支給で使った名前 */
  readonly natureOptions = computed(() => [
    ...new Set([DEFAULT_NATURE, ...this.items().map((i) => i.name), ...this.payments().map((p) => natureOf(p))]),
  ]);
  /** 入力中の名前が当たる項目と、支払日の扱い（当たらなければ null。11/19） */
  readonly natureItem = computed<{ name: string; treatment: BonusTreatment } | null>(() => {
    const [p] = resolveItems([{ nature: this.nature().trim() || null }], this.items(), DEFAULT_NATURE);
    if (!p.rule) return null;
    const year = periodYearOf(this.paidDate() || todayLocal());
    return { name: p.rule.name, treatment: treatmentAt(p.rule, year) };
  });
  /** 従業員ID → 入力中の文字（「500,000」など） */
  readonly amountTexts = signal<Record<string, string>>({});
  /** 読み込んだときの入力（変わったかを見るため） */
  private readonly snapshot = signal('');
  private snapshotOf(): string {
    return JSON.stringify([this.paidDate(), this.title(), this.nature().trim(), this.countAs(), this.amounts()]);
  }
  /** 保存してある額（読み込んだとき。行ごとに「直したか」を見るため。11/18） */
  private readonly savedAmounts = signal<Record<string, number>>({});
  /** 保存していない入力があるか（「保存する」は、直したときだけ下の帯に出す。11/18） */
  readonly dirty = computed(() => !this.loading() && !this.readOnly && this.snapshotOf() !== this.snapshot());
  /** この人の額を直したか（直した行を黄色くする） */
  rowDirty(id: string): boolean {
    return this.badAmounts().has(id) || (this.amounts()[id] ?? 0) !== (this.savedAmounts()[id] ?? 0);
  }
  /** 保存していない入力があれば、画面を離れる前に確かめる（11/17） */
  private readonly unsaved = watchUnsaved(() => !this.loading() && !this.readOnly && this.snapshotOf() !== this.snapshot());

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
  /** 入れた賞与額の合計（11/16） */
  readonly amountTotal = computed(() => Object.values(this.amounts()).reduce((s, n) => s + n, 0));

  /** ほかの支給と支払日が同じ（計算結果を支払日で突き合わせるので、禁止） */
  readonly duplicateDate = computed(
    () =>
      this.dateOk() &&
      this.payments().some((p) => p.id !== this.bonusId && p.paidDate === this.paidDate()),
  );

  /** 特定被保険者（組合健保）：従業員ID → 「月 → 特定被保険者か」。制度を使っていなければ空（11/26） */
  private readonly special = signal<SpecialInsuredMap>(new Map());
  private readonly specialApi = inject(SpecialInsuredService);

  private readonly ctx = computed<BonusContext | null>(() => {
    const tables = this.tables();
    const office = this.context.current();
    if (!tables || !office) return null;
    const special = this.special();
    return { ratesFor: ratesForOffice(office, tables), insurerOf: insurerKeyOf(office), options: this.options(), specialInsuredOf: (id) => special.get(id) };
  });

  /**
   * 保存済みの現物の額（賞与の CSV の「現物」の列で入れたもの。この画面では入れない。11/24）
   * 入力中の支給にも持たせる（落とすと、この画面の標準賞与額・保険料が保存済みの計算より低く出ていた）
   */
  readonly savedInKind = computed<Record<string, number>>(
    () => this.payments().find((p) => p.id === this.bonusId)?.inKindAmounts ?? {},
  );

  /** その人の現物の額（なければ 0） */
  inKindOf(id: string): number {
    return this.savedInKind()[id] ?? 0;
  }

  /** 保存済みの支給に、入力中の内容を差し替えたもの（計算はいつもこれで行う） */
  private readonly draftPayments = computed(() =>
    withDraft(
      this.payments(),
      // 入力中の支給にも、賞与の項目を当てる（対象外・年4回以上の賞与をその場で表に出す。11/19）
      resolveItems(
        [
          {
            id: this.bonusId ?? NEW_ID,
            paidDate: this.paidDate(),
            amounts: this.amounts(),
            inKindAmounts: this.savedInKind(),
            nature: this.nature().trim() || null,
            countAs: this.countAs(),
          },
        ],
        this.items(),
        DEFAULT_NATURE,
      )[0],
    ),
  );

  /** 表の行：支払日に対象になりうる人と、金額を入れた人（打つたびに計算し直す） */
  readonly rows = computed<FormRow[]>(() => {
    const ctx = this.ctx();
    if (!ctx || !this.dateOk()) return [];
    const date = this.paidDate();
    const texts = this.amountTexts();
    const payments = this.draftPayments();
    return this.employees()
      // 70歳以上被用者（75歳以上を含む）も出す：保険料はかからないが、賞与支払届を出すので額を入れる（11/19）
      .filter((e) => eligibleOn(e, date) || isOver70Employee(e, date) || (texts[e.id] ?? '').trim() !== '')
      .map((employee) => ({ employee, ...buildBonusRow(employee, payments, date, ctx) }));
  });

  // ===== 探す・絞る・並べる・ページ（だれに払うかを探せるように。11/12） =====
  private readonly contractsApi = inject(ContractService);
  readonly listOptions = signal<PersonListOptions>(defaultListOptions());
  readonly page = signal(1);
  private readonly contracts = signal<ReadonlyMap<string, ContractDoc[]>>(new Map());

  private contractOf(r: FormRow): ContractDoc | null {
    const list = this.contracts().get(r.employee.id);
    return list && this.dateOk() ? contractAt(list, this.paidDate()) : null;
  }

  readonly filtered = computed(() =>
    filterAndSort(
      this.rows(),
      this.listOptions(),
      (r) => r.employee,
      (r) => this.contractOf(r),
      // 保存済みの額で分ける（打っている途中の行が、目の前から消えないように）
      (r) => this.savedIds().has(r.employee.id),
    ),
  );
  readonly shown = computed(() => pageOf(this.filtered(), this.page(), this.listOptions().size));
  private readonly savedIds = computed(
    () => new Set(Object.keys(this.payments().find((p) => p.id === this.bonusId)?.amounts ?? {})),
  );

  readonly hiddenCount = computed(() =>
    this.dateOk() ? this.employees().length - this.rows().length : 0,
  );

  /** 計算できなかった人（合計に入らない） */
  readonly problemCount = computed(
    () => this.rows().filter((r) => r.state === 'missing' || r.state === 'error').length,
  );

  /** 計算できた人の結果（合計の部品に渡す。保険料一覧と同じ。11/17） */
  readonly okResults = computed(() => this.rows().flatMap((r) => (r.state === 'ok' && r.result ? [r.result] : [])));

  /** 行の下に開く内訳（保険料一覧と同じ。1人ずつ） */
  readonly openId = signal<string | null>(null);
  toggleOpen(id: string): void {
    this.openId.update((cur) => (cur === id ? null : id));
  }

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
      const [employees, payments, tables, items] = await Promise.all([
        this.employeesApi.list(office.id),
        this.bonusApi.list(office.id),
        this.rates.tablesFor(office.id, everKumiai(office)),
        this.itemsApi.list(office.id).catch(() => [] as BonusItem[]),
      ]);
      this.items.set(items);
      this.special.set(await this.specialApi.forEmployees(office.id, office, employees));
      this.employees.set(employees);
      this.payments.set(payments);
      this.tables.set(tables);
      // 契約は絞り込みにだけ使う（読めなくても入力はできる。覚えておいた分は読まない）
      Promise.all(employees.map((e) => this.contractsApi.list(office.id, e.id)))
        .then((lists) => this.contracts.set(new Map(employees.map((e, i) => [e.id, lists[i]]))))
        .catch((err) => console.error(err));

      if (this.bonusId) {
        const p = payments.find((x) => x.id === this.bonusId);
        if (!p) {
          this.loadErrorKey.set('bonus.error.notFound');
          return;
        }
        this.paidDate.set(p.paidDate);
        this.title.set(p.title ?? '');
        this.nature.set(p.nature ?? '');
        this.countAs.set(p.countAs ?? 'normal');
        this.amountTexts.set(
          Object.fromEntries(Object.entries(p.amounts).map(([id, n]) => [id, formatYen(n)])),
        );
      }
    } catch (err) {
      console.error(err);
      this.loadErrorKey.set(errorKeyOf(err, 'bonus.error.load'));
    } finally {
      this.snapshot.set(this.snapshotOf());
      this.savedAmounts.set(this.amounts());
      this.loading.set(false);
    }
  }

  // ===== 入力 =====

  // ===== ファイルから賞与額を読み込む（入力欄に入れるだけ。保存は「保存する」で。11/13） =====
  readonly importAccept = IMPORT_ACCEPT;
  readonly importSpec = BONUS_IMPORT_SPEC;
  /** 読んだファイル（列を合わせている間） */
  readonly importFile = signal<{ name: string; tables: SheetTable[] } | null>(null);
  readonly importResult = signal<(BonusImportResult & { fileName: string; dateNote: DateNote | null }) | null>(null);
  readonly importError = signal<string | null>(null);

  async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importResult.set(null);
    this.importError.set(null);
    try {
      const { tables } = await readTables(file);
      this.importFile.set({ name: file.name, tables });
    } catch (err) {
      console.error(err);
      this.importError.set(err instanceof ImportFileError ? `importMap.error.${err.code}` : 'bonus.import.errorRead');
    }
  }

  /**
   * 列を合わせ終わった → 従業員に結んで、入力欄に入れる
   * - ファイルに支払日の列があり、日付が1つだけなら：支払日が空ならその日を入れる。違う日が入っていれば知らせる（入っている日を使う）
   * - 支払日が決まっていれば、その日に対象になりうる人に結ぶ。決まっていなければ全員に結ぶ（11/16）
   */
  onImportMapped(table: string[][]): void {
    const file = this.importFile();
    this.importFile.set(null);
    // 先に日付だけ読む（結ぶ相手を決めるため）
    const fileDates = matchBonusRows(table, []).paidDates;
    let dateNote: DateNote | null = null;
    if (fileDates.length === 1) {
      const d = fileDates[0];
      if (!this.dateOk()) {
        this.paidDate.set(d);
        dateNote = { key: 'bonus.import.dateSet', params: { date: d }, warn: false };
      } else if (d !== this.paidDate()) {
        dateNote = { key: 'bonus.import.dateDiffers', params: { file: d, date: this.paidDate() }, warn: true };
      }
    } else if (fileDates.length > 1) {
      dateNote = { key: 'bonus.import.dateMany', params: { list: fileDates.join('、') }, warn: true };
    }
    const people = this.dateOk() ? this.rows().map((r) => r.employee) : this.employees();
    const targets = people.map((e) => ({
      id: e.id,
      employeeNumber: e.employeeNumber ?? null,
      lastName: e.lastName,
      firstName: e.firstName,
    }));
    const result = matchBonusRows(table, targets);
    this.amountTexts.update((cur) => {
      const next = { ...cur };
      for (const [id, n] of result.amounts) next[id] = formatYen(n);
      return next;
    });
    this.importResult.set({ ...result, fileName: file?.name ?? '', dateNote });
  }

  cancelImport(): void {
    this.importFile.set(null);
  }

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
      nature: this.nature().trim() || null,
      countAs: this.countAs(),
    };

    this.saving.set(true);
    this.saveErrorKey.set(null);
    try {
      if (this.bonusId) await this.bonusApi.update(office.id, this.bonusId, input);
      else await this.bonusApi.create(office.id, input);
      this.unsaved.release();
      await this.router.navigate(['/o', office.id, 'bonuses']);
      // 一覧に戻ったあとに知らせる（保存の知らせはトーストにそろえる。11/16）
      this.toast.show('bonus.savedToast', 5000);
    } catch (err) {
      console.error(err);
      this.saveErrorKey.set(errorKeyOf(err, 'bonus.error.save'));
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
      this.unsaved.release();
      await this.router.navigate(['/o', office.id, 'bonuses']);
      this.toast.show('common.deleted');
    } catch (err) {
      console.error(err);
      this.saveErrorKey.set(errorKeyOf(err, 'bonus.error.save'));
    } finally {
      this.saving.set(false);
    }
  }

  // ===== 表示の小道具 =====

  // ===== 書き出し（給与ソフトに渡す、社会保険の本人負担まで。11/18） =====
  private readonly transloco = inject(TranslocoService);
  /** 書き出す人（社員番号の順。CSV と「項目を選んで出力」で共通） */
  private exportPeople(): BonusExportItem[] {
    const t = (k: string) => this.transloco.translate(k);
    return [...this.rows()]
      .sort((a, b) => (a.employee.employeeNumber ?? '').localeCompare(b.employee.employeeNumber ?? '', 'ja', { numeric: true }))
      .map((r) => ({
        employeeNumber: r.employee.employeeNumber ?? null,
        name: `${r.employee.lastName} ${r.employee.firstName}`.trim(),
        amountYen: this.amounts()[r.employee.id] ?? 0,
        row: r,
        employee: r.employee,
        note:
          r.state === 'none' && r.over70
            ? t('bonus.state.over70')
            : r.state === 'exempt' || r.state === 'counted' || r.state === 'none' || r.state === 'remuneration' || r.state === 'notCovered'
            ? t('bonus.state.' + r.state)
            : r.state === 'ok' ? '' : t(this.missingKey(r)),
      }));
  }

  /** 保存した内容だけを書き出す（直している途中の額が混ざらないように） */
  exportCsv(): void {
    const office = this.context.current();
    if (!office || this.dirty() || !this.dateOk()) return;
    const t = (k: string) => this.transloco.translate(k);
    const cols = ['number', 'name', 'paidDate', 'amount', 'standard', 'health', 'pension', 'employee', 'employer', 'note'];
    const table = bonusExportTable(cols.map((c) => t('bonus.export.col.' + c)), this.paidDate(), this.exportPeople());
    downloadCsv(safeFileName(`${this.exportStem()}.csv`), table);
  }

  exportCsvFromMenu(ev: Event): void {
    (ev.target as HTMLElement).closest('details')?.removeAttribute('open');
    this.exportCsv();
  }

  // ===== 項目を選んで出力（11/24） =====
  private readonly exportDialog = viewChild(ExportDialog);
  readonly exportDefaultKeys = BONUS_DEFAULT_KEYS;
  /** 窓に渡す人（開くときに作る。額の入っている人だけ） */
  readonly exportItems = signal<BonusExportItem[]>([]);
  readonly exportCatalog = computed(() => {
    const office = this.context.current();
    return bonusExportColumns({
      t: (k) => this.transloco.translate(k),
      deptName: (id) => office?.departments?.find((d) => d.id === id)?.name ?? '',
      paidDate: this.paidDate(),
    });
  });
  readonly exportStem = computed(
    () => `${this.transloco.translate('bonus.export.file')}_${this.context.current()?.name ?? ''}_${this.paidDate()}`,
  );

  openExport(ev: Event): void {
    (ev.target as HTMLElement).closest('details')?.removeAttribute('open');
    if (this.dirty() || !this.dateOk()) return;
    this.exportItems.set(bonusExportItems(this.exportPeople()));
    void this.exportDialog()?.open();
  }

  missingKey(r: FormRow): string {
    if (r.state === 'error') return 'premium.error.calc';
    return `premium.missing.${r.result?.missing[0]?.reason ?? 'noRate'}`;
  }

  readonly yen = (n: number) => n.toLocaleString('ja-JP');
  readonly milli = formatMilli;
}
