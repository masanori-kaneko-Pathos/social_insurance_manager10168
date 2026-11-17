import { afterNextRender, Component, computed, ElementRef, Injector, input, model, output, signal, viewChild, inject } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { downloadCsv } from '../../csv/csv';
import { headerKey } from '../../import/column-map';
import { errorRowsTable, rowRecord, sameKeyLines } from '../../import/row-fix';
import { todayLocal } from '../../utils/date';
import { toHalfWidth } from '../../utils/text';

/** 1行の問題（文は翻訳済みで渡す。headers は問題のある列の見出し＝表にある書き方） */
export interface ImportIssue {
  line: number;
  messages: string[];
  headers: string[];
  /** 押すと欄に入る候補（例：氏名から見つけた社員番号） */
  suggestions?: { label: string; values: Record<string, string> }[];
}

/** 直した1行（見出し → 値）。親は表に入れて、読み直す */
export interface ImportFix {
  line: number;
  values: Record<string, string>;
}

/**
 * 取り込みのエラーの一覧と、1行ずつ直す窓（11/17。どの取り込みの画面もこれを使う）
 * - 一覧は枠の中でスクロールする（見出しは上に貼り付く）
 * - 「直す」でその行の全部の列を開く。問題の列が上、ほかの列は下。同じ社員番号のほかの行（前後の月など）も見られる
 * - 窓を閉じる（×・背景・Esc・やめる）と、直した値は捨てる（ほかの窓と同じ）
 * - エラーの行だけの書き出しと「エラーの行を除いて取り込む」もここ
 */
@Component({
  selector: 'app-import-issues',
  imports: [TranslocoPipe],
  templateUrl: './import-issues.html',
  styleUrl: './import-issues.css',
})
export class ImportIssues {
  /** 読んだ表（1行目が見出し） */
  readonly table = input.required<readonly (readonly string[])[]>();
  readonly issues = input.required<readonly ImportIssue[]>();
  /** 一覧の「内容」に出す列（社員番号・氏名・月など） */
  readonly summaryHeaders = input<readonly string[]>([]);
  /** 同じ値の行を「ほかの行」として見せる列（社員番号など） */
  readonly keyHeader = input<string | null>(null);
  /** 大文字にそろえる列（ローマ字・国コード） */
  readonly upperHeaders = input<readonly string[]>([]);
  /** 書き出すファイルの名前の頭 */
  readonly fileStem = input('import');
  /** エラーの行を除いて取り込むか（親と共有） */
  readonly skip = model(false);
  /** 除いて取り込めるか（重なりなど、除けないものがあるときは false） */
  readonly canSkip = input(true);
  readonly busy = input(false);

  readonly fixed = output<ImportFix>();

  private readonly injector = inject(Injector);
  private readonly transloco = inject(TranslocoService);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');

  /** 開いている行と、窓の中の値 */
  readonly open = signal<ImportIssue | null>(null);
  readonly values = signal<Record<string, string>>({});

  readonly summary = (it: ImportIssue): string => {
    const rec = rowRecord(this.table(), it.line);
    return this.summaryHeaders()
      .map((h) => this.valueOf(rec, h))
      .filter(Boolean)
      .join('　');
  };

  /** 窓：問題の列（上）とほかの列（下） */
  readonly fields = computed(() => {
    const it = this.open();
    if (!it) return { problem: [] as string[], other: [] as string[] };
    const header = (this.table()[0] ?? []).map((h) => h.replace(/^﻿/, '').trim()).filter(Boolean);
    const isProblem = (h: string) => it.headers.some((p) => headerKey(p) === headerKey(h));
    const problem = [...header.filter(isProblem), ...it.headers.filter((p) => !header.some((h) => headerKey(h) === headerKey(p)))];
    return { problem, other: header.filter((h) => !isProblem(h)) };
  });

  /** 窓：同じ鍵のほかの行（前後の月など） */
  readonly neighbors = computed(() => {
    const it = this.open();
    const key = this.keyHeader();
    if (!it || !key) return [];
    return sameKeyLines(this.table(), it.line, key).map((line) => ({ line, rec: rowRecord(this.table(), line) }));
  });
  readonly neighborHeaders = computed(() => (this.table()[0] ?? []).map((h) => h.replace(/^﻿/, '').trim()).filter(Boolean));

  edit(it: ImportIssue): void {
    this.open.set(it);
    this.values.set(rowRecord(this.table(), it.line));
    afterNextRender(
      () => {
        const d = this.dialog()?.nativeElement;
        if (d && !d.open) d.showModal();
        d?.querySelector<HTMLInputElement>('input.problem')?.focus();
      },
      { injector: this.injector },
    );
  }

  valueOf(rec: Record<string, string>, h: string): string {
    const k = Object.keys(rec).find((x) => headerKey(x) === headerKey(h));
    return k ? rec[k] : '';
  }

  setValue(h: string, v: string): void {
    const upper = this.upperHeaders().some((u) => headerKey(u) === headerKey(h));
    this.values.update((m) => ({ ...m, [h]: upper ? toHalfWidth(v).toUpperCase() : v }));
  }

  useSuggestion(values: Record<string, string>): void {
    this.values.update((m) => ({ ...m, ...values }));
  }

  changed(h: string): boolean {
    const it = this.open();
    return !!it && this.valueOf(this.values(), h) !== this.valueOf(rowRecord(this.table(), it.line), h);
  }

  save(): void {
    const it = this.open();
    if (!it) return;
    const before = rowRecord(this.table(), it.line);
    const diff: Record<string, string> = {};
    for (const [h, v] of Object.entries(this.values())) if (this.valueOf(before, h) !== v) diff[h] = v;
    this.close();
    if (Object.keys(diff).length > 0) this.fixed.emit({ line: it.line, values: diff });
  }

  close(): void {
    this.dialog()?.nativeElement.close();
  }

  onClosed(): void {
    this.open.set(null);
  }

  // 背景で押し始めて背景で離したときだけ閉じる（中で選んで外で離したときは閉じない）
  private pressedOnBackdrop = false;
  onPointerDown(e: PointerEvent): void {
    this.pressedOnBackdrop = e.target === this.dialog()?.nativeElement;
  }
  onClick(e: MouseEvent): void {
    if (this.pressedOnBackdrop && e.target === this.dialog()?.nativeElement) this.close();
  }

  exportRows(): void {
    const errorHeader = this.transloco.translate('employeeCsv.errorColumn');
    const messages = new Map(this.issues().map((it) => [it.line, it.messages.join(' ／ ')]));
    downloadCsv(`${this.fileStem()}-errors-${todayLocal()}.csv`, errorRowsTable(this.table(), messages, errorHeader));
  }
}
