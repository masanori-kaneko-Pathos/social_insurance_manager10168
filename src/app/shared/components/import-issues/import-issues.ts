import { afterNextRender, Component, computed, ElementRef, Injector, input, model, output, signal, viewChild, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { downloadCsv } from '../../csv/csv';
import { headerKey } from '../../import/column-map';
import { errorRowsTable, rowRecord, sameKeyLines } from '../../import/row-fix';
import { todayLocal } from '../../utils/date';
import { toHalfWidth } from '../../utils/text';
import { normalizeDate, normalizeMonth } from '../../import/column-map';
import { FixChoice, FixField, isIsoDate, isIsoMonth } from '../../import/fix-fields';

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
  imports: [NgTemplateOutlet, TranslocoPipe],
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
  /** 見出し → 欄の種類（プルダウン・カレンダー・数。11/17）。ない列は文字の欄 */
  readonly fieldTypes = input<Readonly<Record<string, FixField>>>({});

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

  /**
   * 窓：問題の列（上）とほかの列（下）
   * 条件つきの欄（続柄が「その他」なら続柄の補足 など）は、条件の列が問題の列なら、そのすぐ下に出す。条件に合わなければ出さない
   */
  readonly fields = computed(() => {
    const it = this.open();
    if (!it) return { problem: [] as string[], other: [] as string[] };
    this.values(); // 選び直したら出し直す
    const header = (this.table()[0] ?? []).map((h) => h.replace(/^\uFEFF/, '').trim()).filter(Boolean);
    const same = (a: string, b: string) => headerKey(a) === headerKey(b);
    const isProblem = (h: string) => it.headers.some((p) => same(p, h));
    const problem = [...header.filter(isProblem), ...it.headers.filter((p) => !header.some((h) => same(h, p)))];
    for (const [h, t] of Object.entries(this.fieldTypes())) {
      if (!t.when || problem.some((p) => same(p, h))) continue;
      const at = problem.findIndex((p) => same(p, t.when!.header));
      if (at >= 0) problem.splice(at + 1, 0, h);
    }
    const inProblem = (h: string) => problem.some((p) => same(p, h));
    return {
      problem: problem.filter((h) => this.shown(h)),
      other: header.filter((h) => !inProblem(h) && this.shown(h)),
    };
  });

  /** 条件つきの欄を出すか（条件の列の今の値で決める） */
  shown(h: string): boolean {
    const w = this.typeOf(h)?.when;
    if (!w) return true;
    const v = this.matchChoice(w.header) ?? this.valueOf(this.values(), w.header).trim();
    return w.values.includes(v);
  }

  // ===== 選択の枠（押すと下に一覧が開く。11/17） =====
  /** 開いている一覧の列と、矢印キーで選んでいる位置 */
  readonly listOpen = signal<string | null>(null);
  readonly listActive = signal(0);

  selectedLabel(h: string): string {
    const v = this.selectedOf(h);
    return this.choicesOf(h).find((c) => c.value === v)?.label ?? v;
  }

  toggleList(h: string): void {
    if (this.listOpen() === h) {
      this.listOpen.set(null);
      return;
    }
    const i = this.choicesOf(h).findIndex((c) => c.value === this.selectedOf(h));
    this.listOpen.set(h);
    this.listActive.set(Math.max(0, i));
    this.scrollActive();
  }

  pick(h: string, value: string): void {
    this.setValue(h, value);
    this.listOpen.set(null);
  }

  /** 枠と一覧のキー：↓↑で動く・Enter で決める・Esc で閉じる（窓は閉じない） */
  onPickKey(e: KeyboardEvent, h: string): void {
    const open = this.listOpen() === h;
    const n = this.choicesOf(h).length;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.toggleList(h);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.listActive.update((i) => Math.min(n - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1))));
      this.scrollActive();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const c = this.choicesOf(h)[this.listActive()];
      if (c) this.pick(h, c.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.listOpen.set(null);
    } else if (e.key === 'Tab') {
      this.listOpen.set(null);
    }
  }

  private scrollActive(): void {
    afterNextRender(
      () => this.dialog()?.nativeElement.querySelector('.pick-list li.active')?.scrollIntoView({ block: 'nearest' }),
      { injector: this.injector },
    );
  }

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
        d?.querySelector<HTMLElement>('.problem')?.focus();
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
    const num = this.typeOf(h)?.type === 'number';
    this.values.update((m) => ({ ...m, [h]: upper ? toHalfWidth(v).toUpperCase() : num ? toHalfWidth(v) : v }));
    // この列で出る・消える欄：消えたら、入れかけの値を空に戻す
    for (const [dep, t] of Object.entries(this.fieldTypes())) {
      if (t.when && headerKey(t.when.header) === headerKey(h) && !this.shown(dep) && this.valueOf(this.values(), dep) !== '') {
        const key = Object.keys(this.values()).find((x) => headerKey(x) === headerKey(dep)) ?? dep;
        this.values.update((m) => ({ ...m, [key]: '' }));
      }
    }
  }

  // ===== 欄の種類（画面で1件ずつ入れるときと同じ道具で直す。11/17） =====

  typeOf(h: string): FixField | null {
    const types = this.fieldTypes();
    const k = Object.keys(types).find((x) => headerKey(x) === headerKey(h));
    return k ? types[k] : null;
  }

  /** プルダウンの中身：空 ＋（一覧にないファイルの値）＋ 一覧 */
  choicesOf(h: string): { value: string; label: string; file: boolean }[] {
    const t = this.typeOf(h);
    if (t?.type !== 'select') return [];
    const current = this.valueOf(this.values(), h).trim();
    const label = (c: FixChoice) => (c.labelKey ? this.transloco.translate(c.labelKey) : (c.label ?? c.value));
    const list = t.choices.map((c) => ({ value: c.value, label: label(c), file: false }));
    const out = [{ value: '', label: this.transloco.translate('importFix.blank'), file: false }];
    if (current && !this.matchChoice(h)) {
      out.push({ value: current, label: this.transloco.translate('importFix.fileValue', { v: current }), file: true });
    }
    return [...out, ...list];
  }

  /** 今の値に当たる選択肢の値（言葉か表示の名前が同じなら当たり） */
  matchChoice(h: string): string | null {
    const t = this.typeOf(h);
    if (t?.type !== 'select') return null;
    const key = (s: string) => toHalfWidth(s).normalize('NFKC').trim();
    const current = key(this.valueOf(this.values(), h));
    if (!current) return '';
    const hit = t.choices.find(
      (c) => key(c.value) === current || (c.labelKey && key(this.transloco.translate(c.labelKey)) === current) || (c.label && key(c.label) === current),
    );
    return hit ? hit.value : null;
  }

  selectedOf(h: string): string {
    return this.matchChoice(h) ?? this.valueOf(this.values(), h).trim();
  }

  /** カレンダーに入れる値（読めない値なら空。元の値は下に出す） */
  pickerValue(h: string): string {
    const t = this.typeOf(h);
    const v = this.valueOf(this.values(), h);
    if (t?.type === 'date') {
      const d = normalizeDate(v);
      return isIsoDate(d) ? d : '';
    }
    if (t?.type === 'month') {
      const m = normalizeMonth(v);
      return isIsoMonth(m) ? m : '';
    }
    return v;
  }

  /** カレンダーに入らなかったファイルの値（なければ null） */
  unreadOf(h: string): string | null {
    const t = this.typeOf(h);
    if (t?.type !== 'date' && t?.type !== 'month') return null;
    const v = this.valueOf(this.values(), h).trim();
    return v && !this.pickerValue(h) ? v : null;
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
    this.listOpen.set(null);
  }

  // 背景で押し始めて背景で離したときだけ閉じる（中で選んで外で離したときは閉じない）
  private pressedOnBackdrop = false;
  onPointerDown(e: PointerEvent): void {
    this.pressedOnBackdrop = e.target === this.dialog()?.nativeElement;
  }
  onClick(e: MouseEvent): void {
    // 選択の一覧の外を押したら、一覧を閉じる
    if (this.listOpen() && !(e.target as HTMLElement).closest('.pick')) this.listOpen.set(null);
    if (this.pressedOnBackdrop && e.target === this.dialog()?.nativeElement) this.close();
  }

  exportRows(): void {
    const errorHeader = this.transloco.translate('employeeCsv.errorColumn');
    const messages = new Map(this.issues().map((it) => [it.line, it.messages.join(' ／ ')]));
    downloadCsv(`${this.fileStem()}-errors-${todayLocal()}.csv`, errorRowsTable(this.table(), messages, errorHeader));
  }
}
