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
import { belowContract, entryCheck, EntryCheckContext, EntryCheckKind, startsHere } from '../../logic/entry-check';
import { incomingDelta, nthMonthOf, partsOf, SpreadPart, SPREAD_CATEGORIES, SPREAD_CHOICES } from '../../logic/spread';

/** 「この入力で決まること」に出すもの */
export interface EntryCheckView {
  kind: EntryCheckKind;
  startsHere: boolean;
  shortDays: boolean;
  minDays: number;
  /**
   * 固定的賃金の行の名前（出している額に合わせる。一覧の「固定的賃金」の列と違う額のときは、違いを名前に書く）
   * plain：そのまま／beforeDeduction：欠勤控除を引く前／withoutBase：時給・日給×時間を除く
   */
  fixedLabel: 'plain' | 'beforeDeduction' | 'withoutBase';
  /** 固定的賃金（変動を見る額）：前の月（未入力は null）とこの月 */
  fixedPrev: string | null;
  fixedNow: string | null;
  /** 今の標準報酬月額：健保と厚年が同じなら same に入る */
  standard: { same: string | null; health: string | null; pension: string | null } | null;
  /** 3か月の支払月（「11月・12月・1月払い」の材料） */
  months: string;
  /** 固定的賃金が契約の所定内賃金より少ないとき、その所定内賃金（円の文字。少なくなければ null。11/26） */
  contractWage: string | null;
}

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

/** 日数の候補の一覧（datalist）の id に付ける番号 */

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
  /** 支払基礎日数の自動の値（月給・日給月給の人だけ。日数の欄が空のとき、この数で保存する） */
  readonly candidate = input<number | null>(null);
  /** 前の月の内訳（項目名を写す。なければ出さない） */
  readonly prevLines = input<readonly PayrollLine[] | null>(null);
  readonly canEdit = input(true);
  /** 休業を登録する画面へのリンク（その人の従業員のページ。null ＝ 出さない。11/25） */
  readonly leaveLink = input<readonly unknown[] | null>(null);
  /** この給与の対象期間に、休業（産休・育休など）が登録されているか（「休職」を選んだときの知らせ。11/26） */
  readonly onLeave = input(false);
  /** この給与の支払月（内訳の行の「本来の月」の選択肢を作る。11/24） */
  readonly paidMonth = input<string | null>(null);
  /** この人の給与の実績が入っている支払月（本来の月に実績がないと割り振れないので知らせる。null ＝ 分からない） */
  readonly savedMonths = input<ReadonlySet<string> | null>(null);
  /** 内訳の上に出す「誰の・どの月か」（null ＝ 出さない：従業員のページは見出しが別にある。11/26） */
  readonly heading = input<{ name: string; m: number; start: string; end: string } | null>(null);
  /** 前の月にまとめて払った定期代のうち、この月に割り振る分（11/26。読めていなければ空） */
  readonly spreadIn = input<readonly SpreadPart[]>([]);

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
  /** 「この入力で決まること」の材料（null ＝ まだ読めていない：出さない。11/26） */
  readonly check = input<EntryCheckContext | null>(null);
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
      if (d.name.trim() && d.category && amount !== null)
        ok.push({ name: d.name.trim(), category: d.category, amount, forMonth: d.forMonth ?? null, months: d.months ?? null, periodChange: !!d.periodChange });
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

  /** 払った月そのもの（本来の月の選択肢の先頭。「この月」ではなく数字で出す。11/25） */
  readonly thisMonthOption = computed(() => {
    const m = this.paidMonth();
    return m ? { y: m.slice(0, 4), m: String(Number(m.slice(5))) } : null;
  });

  /** 本来の月を選べる行か（報酬にならない行は選べない。遡及支払額は「いつの分から」を選ぶ。11/26） */
  canPickMonth(d: LineDraft): boolean {
    return !!d.category && (FOR_MONTH_CATEGORIES.includes(d.category) || this.isRetro(d)) && this.forMonthOptions().length > 0;
  }

  /** 遡及支払額の行か（同じ欄で「いつの分から」を選ぶ。起算月より前の月の分だけを平均から除くため） */
  isRetro(d: LineDraft): boolean {
    return d.category === 'retro';
  }

  /**
   * 選んだ値：本来の月（'YYYY-MM'）か、まとめて払った月数（'x3'・'x6'。通勤手当だけ。11/26）
   * 同じ欄で選ぶ（欄を増やさない）。本来の月と月数は一緒に持たない
   */
  setForMonth(i: number, value: string): void {
    const next = [...(this.lines() ?? [])];
    if (this.isRetro(next[i])) {
      // 遡及支払額：いつの分から（空 ＝ 分からない：全部除く）
      next[i] = { ...next[i], retroFrom: value || null, forMonth: null, months: null, periodChange: false };
    } else {
      // 'period' ＝ 締め日の変更で増えた期間の分（平均から除く。11/26）
      const period = value === 'period';
      const months = /^x\d+$/.test(value) ? Number(value.slice(1)) : null;
      next[i] = { ...next[i], forMonth: months || period || !value ? null : value, months, periodChange: period };
    }
    this.set(next);
  }

  // ===== まとめて払った定期代（何か月分。11/26） =====

  /** 何か月分を選べる行か（通勤手当） */
  canSpread(d: LineDraft): boolean {
    return !!d.category && SPREAD_CATEGORIES.includes(d.category);
  }

  /** 選べる月数（1 ＝ この月の分は、先頭の「○月払い」と同じなので出さない） */
  readonly spreadChoices = SPREAD_CHOICES.filter((n) => n > 1);

  /** 選択欄の今の値 */
  pickValue(d: LineDraft): string {
    if (this.isRetro(d)) return d.retroFrom ?? '';
    if (d.periodChange) return 'period';
    if (d.months && d.months > 1 && this.canSpread(d)) return `x${d.months}`;
    return d.forMonth ?? '';
  }

  /** この月に払った定期代のうち、次の月から割り振る額（読み取りの帯に出す） */
  readonly spreadLater = computed(() => (this.hasAmounts() ? this.totals().spreadLater : 0));

  /** 前の月から割り振られて、この月の報酬に足す額（この月の分と端数のまま足してから切り捨て） */
  readonly spreadInYen = computed(() => {
    const inc = this.spreadIn();
    if (inc.length === 0) return 0;
    return incomingDelta(this.ownParts(), inc);
  });

  /** この月に払った、まとめ払いの行（読めた行だけ） */
  private ownParts(): SpreadPart[] {
    const m = this.paidMonth() ?? '';
    const ok: PayrollLine[] = [];
    for (const d of this.lines() ?? []) {
      const amount = readAmount(d.amount, d.category);
      if (d.category && amount !== null) ok.push({ name: d.name, category: d.category, amount, forMonth: d.forMonth ?? null, months: d.months ?? null });
    }
    return partsOf(ok, m);
  }

  /** 月割りの行の文（「通勤手当（10月払い・6か月分の2か月目）」と、割った額。端数は小数2桁＋…） */
  spreadInRows(): { name: string; m: string; months: number; nth: number; amount: string }[] {
    const pm = this.paidMonth() ?? '';
    return this.spreadIn().map((p) => ({
      name: p.name,
      m: String(Number(p.paidMonth.slice(5))),
      months: p.months,
      nth: nthMonthOf(p, pm),
      amount: this.shareText(p.amount, p.months),
    }));
  }

  /** 割った額（割り切れなければ小数2桁で切って「…」） */
  shareText(amount: number, months: number): string {
    const whole = Math.floor(amount / months);
    const rest = amount - whole * months;
    if (rest === 0) return this.yen(whole);
    const cents = Math.floor((rest * 100) / months);
    return `${this.yen(whole)}.${String(cents).padStart(2, '0')}…`;
  }

  /** 読み取りの合計（通貨＋現物）。定時決定・随時改定・届出が報酬月額の材料にする額 */
  readback(): { total: string; merged: boolean; otherMonth: number; remuneration: string | null } | null {
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
    // まとめて払った定期代があれば、この月の報酬として計算する額を別に出す（払った額 − 次の月からの分 ＋ 前の月からの分。11/26）
    const later = this.spreadLater();
    const inYen = this.spreadInYen();
    const remuneration = later !== 0 || inYen !== 0 ? this.yen(total - later + inYen) : null;
    return { total: this.yen(total), merged, otherMonth: this.hasAmounts() ? this.totals().otherMonth : 0, remuneration };
  }

  /**
   * 「この入力で決まること」（11/26）。随時改定の起算月になりそうか・平均に入る月かを、入力したその場で出す。
   * 決まりは entry-check.ts（改定の候補の画面と同じ順）。判定は改定の候補の画面で行い、ここは案内だけ
   */
  checkView(): EntryCheckView | null {
    const ctx = this.check();
    if (!ctx) return null;
    const n = (s: string): number | null => {
      const t = toHalfWidth(s ?? '').replace(/[,，\s]/g, '');
      return /^\d+$/.test(t) ? Number(t) : null;
    };
    const c = this.form().controls;
    const lines = this.hasAmounts();
    const t = this.totals();
    // 前の月にまとめて払った定期代の、この月の分も足す（前の月の額も同じように割り振った額。11/26）
    const fixedNow = lines ? t.fixedFull + this.spreadInYen() : n(c.fixed.value);
    const prevFixed = ctx.prev ? (ctx.prev.fixedFull ?? ctx.prev.fixed) : null;
    const r = entryCheck({
      byUnit: ctx.byUnit,
      fixedNow,
      hasLines: lines,
      fixedPrev: prevFixed,
      inKindNow: c.inKindMerged.value ? null : (n(c.inKind.value) ?? 0),
      inKindPrev: ctx.prev ? ctx.prev.inKind : null,
      retro: lines ? t.retro : (n(c.retro.value) ?? 0),
      prorated: !!c.prorated.value,
      contractChange: ctx.contractChange,
      days: n(c.days.value) ?? this.candidate(),
      minDays: ctx.minDays,
    });
    const s = ctx.standard;
    const yenOrNull = (v: number | null) => (v === null ? null : this.yen(v));
    const pm = this.paidMonth();
    // 日割りの月は次の月から数える
    const first = pm ? (r.kind === 'prorated' ? shiftMonth(pm, 1) : pm) : null;
    const months = first ? [0, 1, 2].map((i) => `${Number(shiftMonth(first, i).slice(5))}`).join('・') : '';
    // 契約の所定内賃金より少ない（欠勤控除の前の額で比べる。内訳がないときは欠勤日数が空の月だけ）
    const absent = n(c.absentDays.value);
    const below = belowContract({
      fixedBeforeDeduction: lines || !absent ? fixedNow : null,
      scheduledWage: ctx.scheduledWage,
      prorated: !!c.prorated.value,
    });
    const fixedLabel = !lines ? 'plain' : ctx.byUnit ? 'withoutBase' : t.fixedFull !== t.fixed ? 'beforeDeduction' : 'plain';
    return {
      kind: r.kind,
      fixedLabel,
      startsHere: startsHere(r.kind),
      shortDays: r.shortDays,
      minDays: ctx.minDays,
      fixedPrev: yenOrNull(prevFixed),
      fixedNow: yenOrNull(fixedNow),
      standard: s
        ? s.health !== null && s.health === s.pension
          ? { same: this.yen(s.health), health: null, pension: null }
          : { same: null, health: yenOrNull(s.health), pension: yenOrNull(s.pension) }
        : null,
      months,
      contractWage: below === null ? null : this.yen(below),
    };
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

  /** 「内訳なし」の現物を、分けて入れる */
  splitInKind(): void {
    const f = this.form();
    f.controls.inKindMerged.setValue(false);
    f.controls.inKind.setValue('');
    f.markAsDirty();
  }
}
