import { OpenRow } from '../../../../shared/components/import-issues/open-row';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ColumnMapper } from '../../../../shared/components/column-mapper/column-mapper';
import {
  ImportFix,
  ImportIssue,
  ImportIssues,
} from '../../../../shared/components/import-issues/import-issues';
import { ImportPicker } from '../../../../shared/components/import-picker/import-picker';
import { CsvEncoding, downloadCsv } from '../../../../shared/csv/csv';
import { isOurFormat } from '../../../../shared/import/column-map';
import {
  IMPORT_ACCEPT,
  ImportFileError,
  readTables,
  SheetTable,
} from '../../../../shared/import/parse';
import { applyRowValues } from '../../../../shared/import/row-fix';
import { watchUnsaved } from '../../../../shared/services/unsaved-changes';
import { errorKeyOf } from '../../../../shared/utils/error-key';
import { EmployeeService } from '../../../employees/employee.service';
import { OfficeContext } from '../../../office/office-context.service';
import { BonusService } from '../../bonus.service';
import { BonusItemService } from '../../bonus-item.service';
import type { BonusItem } from '../../../../core/models/bonus-item';
import { itemIndex } from '../../logic/bonus-items';
import { DEFAULT_NATURE } from '../../logic/bonus-nature';
import {
  BONUS_CSV_FIELDS,
  BONUS_FIX_FIELDS,
  BONUS_CSV_HEADERS,
  BONUS_TABLE_SPEC,
  bonusCsvTemplate,
  bonusFixColumns,
  BonusCsvRow,
  BonusExisting,
  BonusPlan,
  bonusWrites,
  planBonusImport,
} from '../../logic/bonus-csv';
import { IssueRow } from '../../../../shared/components/import-issues/issue-row';
import { ImportSteps } from '../../../../shared/components/import-steps/import-steps';
import { PersonName } from '../../../../shared/components/person-name/person-name';
import { todayLocal } from '../../../../shared/utils/date';

interface Preview {
  fileName: string;
  encoding: CsvEncoding | null;
  plan: BonusPlan;
  /** 登録済みの支給（足し込む先。チェックで外した人を抜いて、まとめ直すときに使う） */
  existing: BonusExisting[];
  /** 読んだ表（うちの見出し）。画面で直すとき・エラーの行を書き出すときに使う */
  table: string[][];
}

/**
 * 賞与の取り込み（ファイルの取り込みのページの「賞与」。11/17）
 * 1行 ＝ 1人 × 1回の支給。同じ支払日の行を1回の支給にまとめ、登録済みの支給には足し込む
 * ほかの区分と同じ流れ：ファイル → （見出しが違えば列を合わせる）→ 確認 → 取り込む
 */
@Component({
  selector: 'app-bonus-import',
  imports: [OpenRow, 
    PersonName,
    IssueRow,
    ImportSteps,
    ImportPicker,
    ColumnMapper,
    ImportIssues,
    RouterLink,
    TranslocoPipe,
  ],
  templateUrl: './bonus-import.html',
  styleUrl: '../../../employees/pages/employee-import/employee-import.css',
})
export class BonusImport {
  private readonly employeesApi = inject(EmployeeService);
  private readonly bonusApi = inject(BonusService);
  private readonly itemsApi = inject(BonusItemService);
  private readonly transloco = inject(TranslocoService);
  readonly context = inject(OfficeContext);

  readonly accept = IMPORT_ACCEPT;
  readonly spec = BONUS_TABLE_SPEC;
  readonly headers = BONUS_CSV_HEADERS;

  readonly loaded = signal<{
    fileName: string;
    encoding: CsvEncoding | null;
    tables: SheetTable[];
  } | null>(null);
  readonly mapping = signal(false);
  readonly preview = signal<Preview | null>(null);
  readonly errorKey = signal<string | null>(null);
  readonly saving = signal(false);
  readonly progress = signal<{ done: number; total: number } | null>(null);
  /** 途中で止まったとき：保存できた件数（表は読み直して、保存済みの行は取り込まない側になる。11/26） */
  readonly partial = signal<{ done: number; total: number } | null>(null);
  /** 取り込んだ人数と支給の数 */
  readonly done = signal<{ people: number; payments: number } | null>(null);
  readonly skipErrors = signal(true); // 問題の行は、行のチェックが外れて取り込まない（11/17）
  /** 窓で直すときの欄の種類（11/17） */
  readonly fixFields = BONUS_FIX_FIELDS;
  /** 読んだのにまだ取り込んでいなければ、画面を離れる前に確かめる */
  private readonly unsaved = watchUnsaved(
    () => (this.loaded() !== null || this.preview() !== null) && this.done() === null,
  );

  readonly rows = computed(() => this.preview()?.plan.rows ?? []);

  /** 賞与の項目（確認の段で、ファイルの名前がどの項目に当たるかを見せる。11/19） */
  private readonly items = signal<BonusItem[]>([]);
  /** ファイルに出てくる賞与の項目の名前と、当たる項目（まだ決めていなければ null） */
  readonly natureSummary = computed(() => {
    const index = itemIndex(this.items());
    const names = [
      ...new Set(
        this.rows()
          .filter((r) => r.status !== 'error')
          .map((r) => r.nature?.trim() || DEFAULT_NATURE),
      ),
    ];
    return names.map((name) => ({ name, item: index.get(name)?.name ?? null }));
  });
  readonly hasLooseNames = computed(() => this.natureSummary().some((n) => n.item === null));
  /** 取り込んだあとに出す：未分類の賞与があったか */
  readonly looseAfterImport = signal(false);
  readonly errorRows = computed(() => this.rows().filter((r) => r.status === 'error'));
  // ===== 行ごとのチェック（11/17）：外した人を抜いて、支払日ごとにまとめ直す =====
  private readonly fixRef = viewChild(ImportIssues);
  private kept(line: number): boolean {
    return !(this.fixRef()?.excluded().has(line) ?? false);
  }
  readonly writes = computed(() => {
    const p = this.preview();
    return p
      ? bonusWrites(
          p.plan.rows.filter((r) => this.kept(r.line)),
          p.existing,
        )
      : [];
  });
  readonly peopleToWrite = computed(() => this.writes().reduce((n, w) => n + w.count, 0));
  readonly count = computed(() => {
    const c = { new: 0, add: 0, update: 0, same: 0, error: 0 };
    // チェックで外した行は数えない（取り込むボタンの数と合わせる。エラーはいつも数える）
    for (const r of this.rows()) if (r.status === 'error' || this.kept(r.line)) c[r.status]++;
    return c;
  });
  readonly canImport = computed(
    () =>
      this.context.isAdmin() &&
      !this.saving() &&
      (this.errorRows().length === 0 || this.skipErrors()) &&
      this.writes().length > 0,
  );

  readonly issues = computed<ImportIssue[]>(() =>
    this.errorRows().map((r) => ({
      line: r.line,
      messages: r.errors.map((e) => this.transloco.translate(`bonusCsv.error.${e}`)),
      headers: bonusFixColumns(r.errors).map((c) => this.headers[c]),
    })),
  );

  downloadTemplate(): void {
    downloadCsv('bonuses-template.csv', bonusCsvTemplate());
  }

  async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.reset();
    try {
      const { tables, encoding } = await readTables(file);
      this.loaded.set({ fileName: file.name, encoding, tables });
      const [first] = tables;
      if (tables.length === 1 && !first.pdf && isOurFormat(first.rows[0], BONUS_CSV_FIELDS)) {
        await this.showPreview(first.rows);
      } else {
        this.mapping.set(true);
      }
    } catch (err) {
      console.error(err);
      this.errorKey.set(
        err instanceof ImportFileError ? `importMap.error.${err.code}` : 'employeeCsv.error.read',
      );
    }
  }

  async onMapped(table: string[][]): Promise<void> {
    this.mapping.set(false);
    await this.showPreview(table);
  }

  remap(): void {
    this.preview.set(null);
    this.mapping.set(true);
  }

  async onFix(fix: ImportFix): Promise<void> {
    const p = this.preview();
    if (!p) return;
    await this.showPreview(applyRowValues(p.table, fix.line, fix.values));
  }

  clear(): void {
    this.reset();
  }

  private reset(): void {
    this.partial.set(null);
    this.loaded.set(null);
    this.mapping.set(false);
    this.preview.set(null);
    this.done.set(null);
    this.errorKey.set(null);
    this.skipErrors.set(true);
  }

  private async showPreview(table: string[][]): Promise<void> {
    const office = this.context.current();
    const file = this.loaded();
    if (!office || !file) return;
    try {
      const [employees, payments, items] = await Promise.all([
        this.employeesApi.list(office.id),
        this.bonusApi.list(office.id),
        this.itemsApi.list(office.id).catch(() => [] as BonusItem[]),
      ]);
      this.items.set(items);
      const targets = employees.map((e) => ({
        id: e.id,
        employeeNumber: e.employeeNumber ?? null,
        lastName: e.lastName,
        firstName: e.firstName,
        hireDate: e.hireDate,
        retireDate: e.retireDate ?? null,
      }));
      const plan = planBonusImport(table, targets, payments, todayLocal());
      this.preview.set({
        fileName: file.fileName,
        encoding: file.encoding,
        plan,
        existing: payments,
        table: table.map((r) => [...r]),
      });
    } catch (err) {
      console.error(err);
      this.errorKey.set(errorKeyOf(err, 'employeeCsv.error.read'));
    }
  }

  /** 支払日ごとに、新しく作るか足し込む（1回の支給 ＝ 1件の書き込み） */
  async importCsv(): Promise<void> {
    const office = this.context.current();
    if (!office || !this.canImport()) return;
    const writes = this.writes();
    const people = this.peopleToWrite();
    this.saving.set(true);
    this.progress.set({ done: 0, total: writes.length });
    this.errorKey.set(null);
    this.partial.set(null);
    let done = 0;
    try {
      for (const w of writes) {
        if (w.existingId) await this.bonusApi.update(office.id, w.existingId, w.input);
        else await this.bonusApi.create(office.id, w.input);
        done++;
        this.progress.set({ done, total: writes.length });
      }
      this.looseAfterImport.set(this.hasLooseNames());
      this.done.set({ people, payments: writes.length });
      this.preview.set(null);
      this.loaded.set(null);
    } catch (err) {
      console.error(err);
      if (done > 0) await this.afterPartial(done, writes.length);
      else this.errorKey.set(errorKeyOf(err, 'bonusCsv.error.save'));
    } finally {
      this.saving.set(false);
      this.progress.set(null);
    }
  }

  /** 途中で止まった：件数を出し、表を読み直す（保存済みの支給は「登録済み」として足し込み側に入るので、もう一度押せば残りだけ書く） */
  private async afterPartial(done: number, total: number): Promise<void> {
    this.partial.set({ done, total });
    const table = this.preview()?.table;
    if (table) await this.showPreview(table);
  }

  // ===== 表示 =====

  name(r: BonusCsvRow): string {
    return r.employee ? `${r.employee.lastName} ${r.employee.firstName}` : r.label || '—';
  }

  yen(n: number | null): string {
    return n === null ? '—' : `${n.toLocaleString('ja-JP')}円`;
  }
}
