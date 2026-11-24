import { Component, computed, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { downloadCsv, safeFileName } from '../../csv/csv';
import { ExportColumn, exportTable, ExportPick, groupsOf, knownPicks, movePick, picksOf } from '../../export/export-table';
import { ExportTemplate, ExportTemplateService } from '../../services/export-template.service';
import { downloadXlsx } from '../../xlsx/download-xlsx';
import { todayLocal } from '../../utils/date';

/**
 * 項目を選んで出力する窓（11/24。保険料一覧・従業員一覧などの「出力 ▾」から開く）
 * - 左：出せる項目（まとまりごと）。押すと右の最後に足す
 * - 右：出力する項目。並べ替え（↑↓）、見出しの書き換え、外す（×）
 * - 上：テンプレート（標準の形＋事業所で保存したもの）。管理者は名前を付けて保存・上書き・削除できる
 * - 下：CSV・Excel。対象は一覧の絞り込みのとおり（親が rows に渡す）
 * - 窓を閉じても選んだ列は残る（同じ一覧で開き直したとき続きから）。テンプレートに保存しない限り、ほかの人・次回には残らない
 */
@Component({
  selector: 'app-export-dialog',
  imports: [TranslocoPipe],
  templateUrl: './export-dialog.html',
  styleUrl: './export-dialog.css',
})
export class ExportDialog {
  /** 一覧の種類（テンプレートを分ける鍵：premiums・employees など） */
  readonly dataset = input.required<string>();
  // 行の型は一覧ごとに違うので any で受ける（中身は目録の value が扱う）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly catalog = input.required<readonly ExportColumn<any>[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly rows = input.required<readonly any[]>();
  /** 標準の形（今までの CSV と同じ列） */
  readonly defaultKeys = input.required<readonly string[]>();
  /** ファイルの名前の頭（例：保険料一覧_○○株式会社_2026-10） */
  readonly fileStem = input.required<string>();
  /** Excel のシートの名前 */
  readonly sheetName = input('Sheet1');
  /** 対象の説明（例：絞り込んだ 12人）。親が翻訳して渡す */
  readonly scopeText = input('');
  readonly officeId = input<string | null>(null);
  readonly canSave = input(false);

  private readonly api = inject(ExportTemplateService);
  private readonly transloco = inject(TranslocoService);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  readonly picks = signal<ExportPick[]>([]);
  readonly templates = signal<ExportTemplate[]>([]);
  /** 今の選び方のもとになったテンプレート（'' ＝ 標準の形） */
  readonly templateId = signal('');
  readonly newName = signal('');
  readonly busy = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly savedKey = signal<string | null>(null);
  private started = false;

  readonly groups = computed(() => groupsOf(this.catalog()));
  readonly picked = computed(() => new Set(this.picks().map((p) => p.key)));
  readonly labelOf = (key: string) => this.catalog().find((c) => c.key === key)?.label ?? key;
  readonly current = computed(() => this.templates().find((t) => t.id === this.templateId()) ?? null);

  /** 窓を開く（はじめて開いたときは標準の形。テンプレートを読み直す） */
  async open(): Promise<void> {
    if (!this.started) {
      this.picks.set(picksOf(this.defaultKeys()));
      this.started = true;
    }
    this.errorKey.set(null);
    this.savedKey.set(null);
    this.dialog()?.nativeElement.showModal();
    await this.loadTemplates();
  }

  close(): void {
    this.dialog()?.nativeElement.close();
  }

  private async loadTemplates(): Promise<void> {
    const office = this.officeId();
    if (!office) return;
    try {
      this.templates.set(await this.api.list(office, this.dataset()));
    } catch (err) {
      console.error(err);
      this.errorKey.set('exportDialog.error.load');
    }
  }

  // ===== テンプレート =====

  pickTemplate(id: string): void {
    this.templateId.set(id);
    this.savedKey.set(null);
    const t = this.templates().find((x) => x.id === id);
    this.picks.set(t ? knownPicks(t.columns, this.catalog()) : picksOf(this.defaultKeys()));
  }

  /** 名前を付けて保存（同じ名前があれば上書き） */
  async saveAs(): Promise<void> {
    const office = this.officeId();
    const name = this.newName().trim();
    if (!office || !this.canSave() || !name || this.picks().length === 0) return;
    const same = this.templates().find((t) => t.name === name);
    await this.write(office, { id: same?.id, dataset: this.dataset(), name, columns: this.picks() });
    this.newName.set('');
  }

  /** 選んでいるテンプレートを、今の選び方で上書き */
  async overwrite(): Promise<void> {
    const office = this.officeId();
    const t = this.current();
    if (!office || !this.canSave() || !t || this.picks().length === 0) return;
    await this.write(office, { ...t, columns: this.picks() });
  }

  private async write(office: string, t: Omit<ExportTemplate, 'id'> & { id?: string }): Promise<void> {
    this.busy.set(true);
    this.errorKey.set(null);
    try {
      const id = await this.api.save(office, t);
      await this.loadTemplates();
      this.templateId.set(id);
      this.savedKey.set('exportDialog.saved');
    } catch (err) {
      console.error(err);
      this.errorKey.set('exportDialog.error.save');
    } finally {
      this.busy.set(false);
    }
  }

  async removeTemplate(): Promise<void> {
    const office = this.officeId();
    const t = this.current();
    if (!office || !this.canSave() || !t) return;
    if (!window.confirm(this.transloco.translate('exportDialog.confirmRemove', { name: t.name }))) return;
    this.busy.set(true);
    try {
      await this.api.remove(office, t.id);
      await this.loadTemplates();
      this.pickTemplate('');
    } catch (err) {
      console.error(err);
      this.errorKey.set('exportDialog.error.save');
    } finally {
      this.busy.set(false);
    }
  }

  // ===== 列 =====

  add(key: string): void {
    if (this.picked().has(key)) return;
    this.picks.update((p) => [...p, { key, header: null }]);
    this.savedKey.set(null);
  }

  remove(i: number): void {
    this.picks.update((p) => p.filter((_, j) => j !== i));
    this.savedKey.set(null);
  }

  move(i: number, dir: -1 | 1): void {
    this.picks.update((p) => movePick(p, i, dir));
    this.savedKey.set(null);
  }

  rename(i: number, text: string): void {
    this.picks.update((p) => p.map((x, j) => (j === i ? { ...x, header: text } : x)));
    this.savedKey.set(null);
  }

  addAll(): void {
    this.picks.update((p) => [...p, ...this.catalog().filter((c) => !this.picked().has(c.key)).map((c) => ({ key: c.key, header: null }))]);
  }

  clearAll(): void {
    this.picks.set([]);
  }

  // ===== 出力 =====

  private table(): string[][] {
    return exportTable(this.rows(), this.catalog(), this.picks());
  }

  private stem(): string {
    const t = this.current();
    return safeFileName(t ? `${this.fileStem()}_${t.name}` : this.fileStem());
  }

  exportCsv(): void {
    if (this.picks().length === 0) return;
    downloadCsv(`${this.stem()}.csv`, this.table());
  }

  async exportXlsx(): Promise<void> {
    if (this.picks().length === 0) return;
    await downloadXlsx(`${this.stem()}.xlsx`, this.sheetName(), this.table());
  }

  // 背景で押し始めて背景で離したときだけ閉じる（中で選んで外で離したときは閉じない。ほかの窓と同じ）
  private pressedOnBackdrop = false;
  onPointerDown(e: PointerEvent): void {
    this.pressedOnBackdrop = e.target === this.dialog()?.nativeElement;
  }
  onClick(e: MouseEvent): void {
    if (this.pressedOnBackdrop && e.target === this.dialog()?.nativeElement) this.close();
  }

  readonly today = todayLocal();
}
