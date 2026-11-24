import { Component, computed, ElementRef, inject, input, model, OnInit, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import type { PayType } from '../../../../core/models/contract';
import { PAYROLL_STATES, PayrollLine, PayrollState } from '../../../../core/models/payroll';
import { PayrollItemCategory, PayrollItemInput, PAYROLL_ITEM_CATEGORIES } from '../../../../core/models/payroll-item';
import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
import { toHalfWidth } from '../../../../shared/utils/text';
import { categoryOf, FOR_MONTH_CATEGORIES, hasAmounts, itemKey, itemNames, LineDraft, readAmount, readLines, startDrafts, totalsOf } from '../../logic/payroll-lines';
import { shiftMonth } from '../../../../shared/utils/date';
import type { RowError } from '../../logic/payroll-input';

/** 1人分の入力の文字（月の表の行と同じ形。cash・fixed・retro は内訳があれば内訳から入る） */
export type PayrollRowForm = FormGroup<{
  cash: FormControl<string>;
  fixed: FormControl<string>;
  inKind: FormControl<string>;
  /** 現物が「内訳なし」（総支給額に含まれている。取り込みで入る） */
  inKindMerged: FormControl<boolean>;
  retro: FormControl<string>;
  days: FormControl<string>;
  absentDays: FormControl<string>;
  hours: FormControl<string>;
  prorated: FormControl<boolean>;
  state: FormControl<PayrollState>;
}>;

/**
 * 給与明細の内訳を入れる（1人・1か月分。11/24）
 * 月の画面では行の下に開く。左に明細の支給の行（項目名・分類・金額）、右に日数・時間・現物
 * 行を変えるたびに、総支給額・固定的賃金・昇給差額を form に入れる（一覧の表示・合計・保存は form を読む）
 */
@Component({
  selector: 'app-payroll-entry',
  imports: [ReactiveFormsModule, RouterLink, TranslocoPipe, HalfWidthDigits],
  templateUrl: './payroll-entry.html',
  styleUrl: './payroll-entry.css',
})
export class PayrollEntry implements OnInit {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly form = input.required<PayrollRowForm>();
  /** 内訳の行（null ＝ 内訳なし：前のデータ・総支給額だけの取り込み） */
  readonly lines = model<LineDraft[] | null>(null);
  readonly items = input<readonly PayrollItemInput[]>([]);
  readonly payType = input<PayType | null>(null);
  /** 支払基礎日数の候補（月給の人だけ） */
  readonly candidate = input<number | null>(null);
  /** 前の月の内訳（項目名を写す。なければ出さない） */
  readonly prevLines = input<readonly PayrollLine[] | null>(null);
  readonly canEdit = input(true);
  /** この給与の支払月（内訳の行の「本来の月」の選択肢を作る。11/24） */
  readonly paidMonth = input<string | null>(null);
  /** この人の給与の実績が入っている支払月（本来の月に実績がないと割り振れないので知らせる。null ＝ 分からない） */
  readonly savedMonths = input<ReadonlySet<string> | null>(null);

  /** 本来の月を選んだのに、その月の実績がない行か */
  missingTarget(d: LineDraft): boolean {
    const s = this.savedMonths();
    return !!d.forMonth && !!s && !s.has(d.forMonth);
  }

  monthParts(ym: string): { y: string; m: string } {
    return { y: ym.slice(0, 4), m: String(Number(ym.slice(5))) };
  }
  /** 保存を押したあとの誤り（押す前は行の誤りを出さない） */
  readonly errors = input<readonly RowError[]>([]);
  /** 次の人がいるか（いなければ「保存する」） */
  readonly hasNext = input(true);
  readonly saving = input(false);
  /** 現物給与の計算（価額表）を出すか（計算の窓を開ける画面だけ） */
  readonly inKindCalc = input(true);
  /** 事業所のひな形（内訳を入れ始めるときに並べる。null ＝ まだない：アプリの例） */
  readonly template = input<readonly string[] | null>(null);
  /** 「給与の項目と分類」の画面へのリンク（分類が決まっていない項目の横に出す） */
  readonly itemsLink = input<readonly unknown[] | null>(null);
  /** 「この並びを事業所のひな形にする」を押した（親が保存する） */
  readonly saveTemplate = output<string[]>();
  /** ひな形にした（同じ並びのあいだ「ひな形にしました」と出す） */
  readonly templateDone = signal(false);

  readonly save = output<void>();
  readonly closed = output<void>();
  readonly openInKind = output<void>();

  readonly states = PAYROLL_STATES;
  readonly categories = PAYROLL_ITEM_CATEGORIES;
  readonly names = computed(() => itemNames(this.items()));
  /** datalist の id（同じ画面に2つ開いても重ならないように） */
  readonly listId = `pi-names-${Math.random().toString(36).slice(2, 8)}`;

  readonly read = computed(() => readLines(this.lines() ?? []));
  readonly showLineErrors = computed(() => this.errors().includes('lines'));

  /** 読めた行だけで出した合計（入力中でも見せる） */
  readonly totals = computed(() => {
    const ok: PayrollLine[] = [];
    for (const d of this.lines() ?? []) {
      const amount = readAmount(d.amount, d.category);
      if (d.name.trim() && d.category && amount !== null) ok.push({ name: d.name.trim(), category: d.category, amount, forMonth: d.forMonth ?? null });
    }
    return totalsOf(ok, this.payType());
  });

  /** 名前が分類の決まっていない項目名か（選んだ分類は「給与の項目と分類」にも登録する） */
  unknown(d: LineDraft): boolean {
    return !!d.name.trim() && categoryOf(d.name, this.items()) === null;
  }

  lineErrorsOf(i: number) {
    return this.showLineErrors() ? (this.read().lineErrors.get(i) ?? []) : [];
  }

  /** 内訳なしのとき：非固定的賃金 ＝ 総支給額 − 固定的賃金 − 昇給差額（読めなければ空） */
  directNonFixed(): string {
    const n = (s: string) => {
      const t = toHalfWidth(s).replace(/[,，\s]/g, '');
      return t === '' ? 0 : /^\d+$/.test(t) ? Number(t) : NaN;
    };
    const c = this.form().controls;
    if (c.cash.value.trim() === '') return '';
    const v = n(c.cash.value) - n(c.fixed.value) - n(c.retro.value);
    return Number.isFinite(v) && v >= 0 ? this.yen(v) : '';
  }

  yen(n: number): string {
    return n.toLocaleString('ja-JP');
  }

  // ===== 本来の月（払い忘れ・計算誤りの精算。11/24） =====

  /** 選べる月：この支払月より前の12か月（新しい順） */
  readonly forMonthOptions = computed(() => {
    const m = this.paidMonth();
    if (!m) return [];
    return Array.from({ length: 12 }, (_, i) => {
      const v = shiftMonth(m, -(i + 1));
      // 同じ年なら「4月払い」、年をまたいだら「2025年12月払い」（欄を狭く保つ）
      return { value: v, y: v.slice(0, 4), m: String(Number(v.slice(5))), sameYear: v.slice(0, 4) === m.slice(0, 4) };
    });
  });

  /** 本来の月を選べる行か（遡及支払額・報酬にならない行は選べない） */
  canPickMonth(d: LineDraft): boolean {
    return !!d.category && FOR_MONTH_CATEGORIES.includes(d.category) && this.forMonthOptions().length > 0;
  }

  setForMonth(i: number, value: string): void {
    const next = [...(this.lines() ?? [])];
    next[i] = { ...next[i], forMonth: value || null };
    this.set(next);
  }

  /** 読み取りの合計（通貨＋現物）。定時決定・随時改定・届出が報酬月額の材料にする額 */
  readback(): { total: string; merged: boolean; otherMonth: number } | null {
    const n = (s: string) => {
      const t = toHalfWidth(s ?? '').replace(/[,，\s]/g, '');
      return t === '' ? 0 : /^\d+$/.test(t) ? Number(t) : NaN;
    };
    const c = this.form().controls;
    const cash = this.hasAmounts() ? this.totals().cash : n(c.cash.value);
    if (!this.hasAmounts() && c.cash.value.trim() === '') return null;
    const merged = !!c.inKindMerged.value;
    const total = cash + (merged ? 0 : n(c.inKind.value));
    if (!Number.isFinite(total)) return null;
    return { total: this.yen(total), merged, otherMonth: this.hasAmounts() ? this.totals().otherMonth : 0 };
  }

  // ===== 行の編集 =====

  private set(next: LineDraft[]): void {
    this.lines.set(next);
    this.templateDone.set(false);
    this.syncTotals();
  }

  /** 金額が1つでも入っているか（入っていなければ合計は「—」。総支給額の欄も入れ替えない） */
  readonly hasAmounts = computed(() => hasAmounts(this.lines()));


  /** 内訳から出した額を、一覧と保存が読む欄に入れる（金額が入ってから） */
  private syncTotals(): void {
    const t = this.totals();
    const f = this.form();
    if (!this.hasAmounts()) return;
    f.controls.cash.setValue(String(t.cash));
    f.controls.fixed.setValue(String(t.fixed));
    f.controls.retro.setValue(t.retro === 0 ? '' : String(t.retro));
    f.markAsDirty();
  }

  /** 内訳がない月（前のデータ・総支給額だけの取り込み）を開いたら、行を並べておく（前の月の項目名 → 事業所の給与項目 → アプリの例） */
  ngOnInit(): void {
    if (this.lines() === null && this.canEdit()) this.lines.set(startDrafts(this.prevLines(), this.template(), this.items()));
  }

  /** 今の行の項目名（空は除く・同じ名前は1つ） */
  private namesNow(): string[] {
    const out: string[] = [];
    for (const d of this.lines() ?? []) {
      const n = d.name.trim();
      if (n && !out.some((o) => itemKey(o) === itemKey(n))) out.push(n);
    }
    return out;
  }

  /** 今の並びが、事業所のひな形と違うか（同じなら「ひな形にする」は出さない） */
  readonly differsFromTemplate = computed(() => {
    const now = this.namesNow();
    const t = this.template() ?? [];
    return now.length > 0 && (now.length !== t.length || now.some((n, i) => itemKey(n) !== itemKey(t[i])));
  });

  makeTemplate(): void {
    this.saveTemplate.emit(this.namesNow());
    this.templateDone.set(true);
  }

  setName(i: number, name: string): void {
    const next = [...(this.lines() ?? [])];
    const before = next[i];
    // 項目名から分類が決まればそれ。決まらない名前なら、前に選んだ分類を残す（前の名前も決まらない名前だったときだけ）
    const known = categoryOf(name, this.items());
    const keep = categoryOf(before.name, this.items()) === null ? before.category : null;
    next[i] = { ...before, name, category: known ?? keep };
    this.set(next);
  }

  setCategory(i: number, value: string): void {
    const next = [...(this.lines() ?? [])];
    next[i] = { ...next[i], category: (PAYROLL_ITEM_CATEGORIES as readonly string[]).includes(value) ? (value as PayrollItemCategory) : null };
    this.set(next);
  }

  setAmount(i: number, amount: string): void {
    const next = [...(this.lines() ?? [])];
    next[i] = { ...next[i], amount };
    this.set(next);
  }

  addLine(): void {
    const next = [...(this.lines() ?? []), { name: '', category: null, amount: '' }];
    this.lines.set(next);
    this.focusLine(next.length - 1);
  }

  removeLine(i: number): void {
    const next = (this.lines() ?? []).filter((_, k) => k !== i);
    this.set(next.length > 0 ? next : [{ name: '', category: null, amount: '' }]);
  }

  /** 金額で Enter：次の行の金額へ。最後の行なら新しい行を足す（明細をなぞる動き） */
  onAmountEnter(i: number, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const n = (this.lines() ?? []).length;
    if (i < n - 1) this.focusLine(i + 1, 'amount');
    else this.addLine();
  }

  private focusLine(i: number, field: 'name' | 'amount' = 'name'): void {
    setTimeout(() => {
      const el = (this.host.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        `[data-line="${i}"] [data-f="${field}"]`,
      );
      el?.focus();
    });
  }

  /** 控除の行は「−」を付けて見せる（入れるのは正の数でよい） */
  isMinus(d: LineDraft): boolean {
    return d.category === 'deduction';
  }

  /** 支払基礎日数が候補と違う（月給の人。勤務日数を入れる間違いに気づけるように） */
  daysOff(): number | null {
    const c = this.candidate();
    const t = this.form().controls.days.value.trim();
    if (c === null || t === '') return null;
    return Number(toHalfWidth(t)) === c ? null : c;
  }

  fillCandidate(): void {
    const c = this.candidate();
    if (c === null) return;
    this.form().controls.days.setValue(String(c));
    this.form().markAsDirty();
  }

  /** 「内訳なし」の現物を、分けて入れる */
  splitInKind(): void {
    const f = this.form();
    f.controls.inKindMerged.setValue(false);
    f.controls.inKind.setValue('');
    f.markAsDirty();
  }
}
