import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  convertRow,
  guessMapping,
  ImportField,
  Mapping,
  missingRequired,
  OurTableSpec,
  Source,
  toOurTable,
  unusedColumns,
} from '../../import/column-map';
import { SheetTable } from '../../import/parse';

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
  readonly confirmed = output<string[][]>();
  readonly cancelled = output<void>();

  readonly sheet = signal(0);
  readonly table = computed(() => this.tables()[this.sheet()]?.rows ?? []);
  readonly pdf = computed(() => !!this.tables()[this.sheet()]?.pdf);
  readonly headers = computed(() => this.table()[0] ?? []);
  private readonly fields = computed<readonly ImportField[]>(() => this.spec().fields);
  private readonly guessed = computed(() => guessMapping(this.headers(), this.fields()));

  /** 今の対応（シートを変えたら、自動で当て直す） */
  readonly mapping = linkedSignal<Mapping>(() => ({ ...this.guessed() }));

  /** 上に出す項目：必須と、自動で結べたもの。残りは「そのほかの項目」に畳む（選んでも行が動かないよう、当てた時点で決める） */
  readonly mainFields = computed(() =>
    this.fields().filter((f) => f.required || this.guessed()[f.key]),
  );
  readonly moreFields = computed(() =>
    this.fields().filter((f) => !f.required && !this.guessed()[f.key]),
  );

  readonly samples = computed(() =>
    this.table()
      .slice(1)
      .filter((r) => r.some((c) => c.trim() !== ''))
      .slice(0, SAMPLE_ROWS)
      .map((r) => convertRow(r, this.mapping(), this.spec())),
  );
  readonly missing = computed(() => missingRequired(this.fields(), this.mapping()));
  readonly unused = computed(() => unusedColumns(this.headers(), this.mapping()));

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

  example(key: string, i: number): string {
    return this.samples()[i]?.[key] ?? '';
  }

  // ===== 操作 =====

  pickSheet(value: string): void {
    this.sheet.set(Number(value));
  }

  onSource(key: string, value: string): void {
    let s: Source = null;
    if (value === 'fixed') s = { fixed: this.fixedOf(key) };
    else if (value.startsWith('c:')) s = { col: Number(value.slice(2)) };
    this.mapping.update((m) => ({ ...m, [key]: s }));
  }

  onFixed(key: string, text: string): void {
    this.mapping.update((m) => ({ ...m, [key]: { fixed: text } }));
  }

  confirm(): void {
    if (this.missing().length > 0) return;
    this.confirmed.emit(toOurTable(this.table(), this.mapping(), this.spec()));
  }
}
