import { Component, computed, effect, inject, input, linkedSignal, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  canSum,
  convertRow,
  DerivedFormula,
  fromSavedMapping,
  guessMapping,
  ImportField,
  Mapping,
  missingRequired,
  OurTableSpec,
  SavedMapping,
  Source,
  toOurTable,
  toSavedMapping,
  unusedColumns,
} from '../../import/column-map';
import { SheetTable } from '../../import/parse';
import { ImportMappingService } from '../../services/import-mapping.service';

/** 例として見せる行の数 */
const SAMPLE_ROWS = 3;

/**
 * 「列を合わせる」画面の部品（従業員・給与の取り込みで使う）
 * - よそのファイルの見出しを、うちの項目に自動で結び、人が直す
 * - 項目ごとに［ファイルの列から／全員に同じ値／使わない］を選ぶ
 * - 例の欄には、言い直したあとの値を出す（日付・カナ・計算した週の時間などを、取り込む前に確かめられる）
 * - 「この対応で確かめる」で、見出しがうちの名前の表を返す（あとは今までの確認画面）
 */
@Component({
  selector: 'app-column-mapper',
  imports: [NgTemplateOutlet, TranslocoPipe],
  templateUrl: './column-mapper.html',
  styleUrl: './column-mapper.css',
})
export class ColumnMapper {
  readonly tables = input.required<SheetTable[]>();
  // 項目の型は画面ごとに違うので、ここでは any で受ける（中身は column-map の関数が扱う）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly spec = input.required<OurTableSpec<any, any>>();
  /** 項目どうしの計算があるときの注意（翻訳キー） */
  readonly noteKey = input<string | null>(null);
  /**
   * 割り当てを覚えておく鍵（取り込みの種類。payrolls・bonuses など）と事業所。両方あれば前回の割り当てを使い、
   * canSave（管理者）なら「この対応で確認する」で覚える（11/24）
   */
  readonly memoryKey = input<string | null>(null);
  readonly officeId = input<string | null>(null);
  readonly canSave = input(false);
  readonly confirmed = output<string[][]>();
  readonly cancelled = output<void>();

  readonly sheet = signal(0);
  readonly table = computed(() => this.tables()[this.sheet()]?.rows ?? []);
  readonly pdf = computed(() => !!this.tables()[this.sheet()]?.pdf);
  readonly headers = computed(() => this.table()[0] ?? []);
  private readonly fields = computed<readonly ImportField[]>(() => this.spec().fields);
  private readonly guessed = computed(() => guessMapping(this.headers(), this.fields()));

  private readonly mappingApi = inject(ImportMappingService);
  /** 前回この事業所で使った割り当て（なければ null） */
  private readonly saved = signal<SavedMapping | null>(null);
  /** 前回の割り当てを使っているか */
  readonly restored = computed(() => this.saved() !== null);
  /** はじめの割り当て：前回の割り当てがあればそれ（見つからない列は自動の結果）、なければ自動で当てた結果 */
  private readonly initial = computed<Mapping>(() => {
    const saved = this.saved();
    return saved ? fromSavedMapping(this.headers(), this.fields(), saved, this.guessed()) : this.guessed();
  });

  /** 今の対応（シートを変えたら、当て直す） */
  readonly mapping = linkedSignal<Mapping>(() => ({ ...this.initial() }));

  /** 上に出す項目：必須と、はじめから結べたもの。残りは「そのほかの項目」に畳む（選んでも行が動かないよう、当てた時点で決める） */
  readonly mainFields = computed(() =>
    this.fields().filter((f) => f.required || this.initial()[f.key]),
  );
  readonly moreFields = computed(() =>
    this.fields().filter((f) => !f.required && !this.initial()[f.key]),
  );

  constructor() {
    // 前回の割り当てを読む（読めなくても自動の当て方で続けられる）
    effect(() => {
      const key = this.memoryKey();
      const office = this.officeId();
      if (!key || !office) return;
      this.mappingApi
        .get(office, key)
        .then((m) => this.saved.set(m))
        .catch((err) => console.error(err));
    });
  }

  /** 前回の割り当てをやめて、自動で当てた結果に戻す */
  useAuto(): void {
    this.saved.set(null);
  }

  readonly samples = computed(() =>
    this.table()
      .slice(1)
      .filter((r) => r.some((c) => c.trim() !== ''))
      .slice(0, SAMPLE_ROWS)
      .map((r) => convertRow(r, this.mapping(), this.spec())),
  );
  /** 計算で埋まる項目（給与の明細の内訳の列から。11/25） */
  readonly derived = computed(() => this.spec().derived?.(this.headers()) ?? null);
  private readonly derivedKeys = computed<readonly string[]>(() => this.derived()?.keys ?? []);
  /** 結ばずに、計算で埋めている項目か */
  isDerived(key: string): boolean {
    return this.derivedKeys().includes(key) && this.sourceValue(key) === '';
  }
  /** 例の行ごとの式（ファイルの行のまま渡す） */
  private readonly formulas = computed(() => {
    const d = this.derived();
    if (!d) return [];
    return this.table()
      .slice(1)
      .filter((r) => r.some((c) => c.trim() !== ''))
      .slice(0, SAMPLE_ROWS)
      .map((r) => d.formula(r));
  });
  formulaOf(key: string, i = 0): DerivedFormula | null {
    return this.formulas()[i]?.[key] ?? null;
  }
  /** 式の文字：基本給 250,000 ＋ 役職手当 20,000 − 欠勤控除 5,000 ＝ 265,000 */
  formulaText(key: string): string {
    const f = this.formulaOf(key);
    if (!f) return '';
    const yen = (n: number) => Math.abs(n).toLocaleString('ja-JP');
    const terms = f.terms
      .map((t, i) => `${i === 0 ? (t.amount < 0 ? '− ' : '') : t.amount < 0 ? ' − ' : ' ＋ '}${t.name} ${yen(t.amount)}`)
      .join('');
    return `${terms} ＝ ${f.total.toLocaleString('ja-JP')}`;
  }

  readonly missing = computed(() => missingRequired(this.fields(), this.mapping(), this.derivedKeys()));
  /** そのまま後ろに付けて渡す列（給与の内訳の列。「使わない列」には出さない） */
  readonly passed = computed(() => {
    const pass = this.spec().passThrough;
    return pass ? this.headers().map((h, i) => (pass(h) ? i : -1)).filter((i) => i >= 0) : [];
  });
  /** 列を足せる項目があるか（あれば上に説明を出す。11/24） */
  readonly hasSummable = computed(() => this.fields().some((f) => canSum(f)));
  readonly unused = computed(() => unusedColumns(this.headers(), this.mapping()).filter((i) => !this.passed().includes(i)));

  // ===== 表示 =====

  headerOf(key: string): string {
    return this.fields().find((f) => f.key === key)?.header ?? key;
  }

  /** 必須の項目の「または ○○＋○○ から計算」 */
  orFromText(f: ImportField): string {
    return (f.orFrom ?? []).map((k) => this.headerOf(k)).join('＋');
  }

  columnName(i: number): string {
    return this.headers()[i]?.trim() || `#${i + 1}`;
  }

  /** プルダウンの値：'' 使わない・'fixed' 全員に同じ値・'c:3' ファイルの4列目 */
  sourceValue(key: string): string {
    const s = this.mapping()[key];
    if (!s) return '';
    return 'col' in s ? `c:${s.col}` : 'fixed';
  }

  fixedOf(key: string): string {
    const s = this.mapping()[key];
    return s && 'fixed' in s ? s.fixed : '';
  }

  canSum(f: ImportField): boolean {
    return canSum(f);
  }

  /** 足した列（金額の項目で、ファイルの列から取るときだけ） */
  plusOf(key: string): number[] {
    const s = this.mapping()[key];
    return s && 'col' in s ? (s.plus ?? []) : [];
  }

  /** 「＋列を足す」に出す列：まだ使っていない列だけ（その項目の列・足した列は出さない） */
  plusChoices(key: string): number[] {
    const s = this.mapping()[key];
    if (!s || !('col' in s)) return [];
    const taken = new Set([s.col, ...(s.plus ?? [])]);
    return this.headers().map((_, i) => i).filter((i) => !taken.has(i) && this.headers()[i].trim() !== '');
  }

  example(key: string, i: number): string {
    if (this.isDerived(key)) return this.formulaOf(key, i)?.total.toLocaleString('ja-JP') ?? '';
    return this.samples()[i]?.[key] ?? '';
  }

  // ===== 操作 =====

  pickSheet(value: string): void {
    this.sheet.set(Number(value));
  }

  onSource(key: string, value: string): void {
    let s: Source = null;
    if (value === 'fixed') s = { fixed: this.fixedOf(key) };
    else if (value.startsWith('c:')) {
      // 足した列は残す（いま選んだ列と同じものだけ外す）
      const col = Number(value.slice(2));
      const plus = this.plusOf(key).filter((i) => i !== col);
      s = plus.length > 0 ? { col, plus } : { col };
    }
    this.mapping.update((m) => ({ ...m, [key]: s }));
  }

  addPlus(key: string, value: string): void {
    const s = this.mapping()[key];
    if (!s || !('col' in s) || value === '') return;
    this.mapping.update((m) => ({ ...m, [key]: { col: s.col, plus: [...(s.plus ?? []), Number(value)] } }));
  }

  removePlus(key: string, col: number): void {
    const s = this.mapping()[key];
    if (!s || !('col' in s)) return;
    const plus = (s.plus ?? []).filter((i) => i !== col);
    this.mapping.update((m) => ({ ...m, [key]: plus.length > 0 ? { col: s.col, plus } : { col: s.col } }));
  }

  onFixed(key: string, text: string): void {
    this.mapping.update((m) => ({ ...m, [key]: { fixed: text } }));
  }

  confirm(): void {
    if (this.missing().length > 0) return;
    const key = this.memoryKey();
    const office = this.officeId();
    if (key && office && this.canSave()) {
      // 覚えるのは取り込みの手助けなので、失敗しても取り込みは止めない
      this.mappingApi.save(office, key, toSavedMapping(this.headers(), this.mapping())).catch((err) => console.error(err));
    }
    this.confirmed.emit(toOurTable(this.table(), this.mapping(), this.spec()));
  }
}
