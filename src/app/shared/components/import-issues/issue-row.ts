import { Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { headerKey } from '../../import/column-map';
import { rowRecord } from '../../import/row-fix';
import { ImportIssue, ImportIssues } from './import-issues';

/**
 * 問題の行の1つの欄の、1行分（11/18）
 * - 'セイ'：その列の値だけで1行
 * - ['セイ', 'メイ']：空白でつないで1行（「森 真由美」）
 * - { hs, sep, pre }：sep でつなぎ、頭に pre を付ける（「正社員・月給」「〜2026-09-30」）
 */
export type IssueLine = string | readonly string[] | { readonly hs: readonly string[]; readonly sep?: string; readonly pre?: string };
/** 問題の行の1つの欄（上から順に行を並べる） */
export type IssueCol = readonly IssueLine[];

function normLine(l: IssueLine): { hs: readonly string[]; sep: string; pre: string } {
  if (typeof l === 'string') return { hs: [l], sep: ' ', pre: '' };
  if (Array.isArray(l)) return { hs: l as readonly string[], sep: ' ', pre: '' };
  const o = l as Exclude<IssueLine, string | readonly string[]>;
  return { hs: o.hs, sep: o.sep ?? ' ', pre: o.pre ?? '' };
}

/**
 * 表の中の問題の行（11/17）：<tr app-issue-row [issue]="…" [fix]="fix" [cols]="表の列ごとの見出し">
 * 取り込んだときと同じ列に、ファイルに書いてあった値を並べる（問題の値は赤く太く）。説明は「詳細」の窓で読む
 * 表にない列の問題（セイ・マイナンバーなど）は、最後の欄に「セイ：やまだ」と出す
 * cols を渡さない表では、行の中身と説明を1つの欄にまとめて出す（span は真ん中の欄の列の数）
 */
@Component({
  selector: 'tr[app-issue-row]',
  imports: [TranslocoPipe],
  template: `
    <td class="pick-col"><input type="checkbox" disabled [attr.aria-label]="'importFix.notKept' | transloco" /></td>
    <td class="num">{{ issue().line }}</td>
    @if (cells().length > 0) {
      @for (c of cells(); track $index; let last = $last) {
        <td class="val">
          @for (ln of c; track $index) {
            <span class="cell-line"
              >{{ ln.pre }}@for (v of ln.parts; track v.header; let first = $first) {@if (!first) {<span>{{ ln.sep }}</span>}<span [class.bad]="v.bad">{{ v.value || ('importFix.blank' | transloco) }}</span>}</span
            >
          } @empty {
            —
          }
          @if (last) {
            @for (v of extra(); track v.header) {
              <span class="issue-value">{{ v.header }}：<b>{{ v.value || ('importFix.blank' | transloco) }}</b></span>
            }
          }
        </td>
      }
      <td class="act-col">
        <button type="button" class="btn btn-small btn-primary" [disabled]="fix().busy()" (click)="fix().edit(issue())">
          {{ 'importFix.check' | transloco }}
        </button>
      </td>
    } @else {
      <td [attr.colspan]="span()" class="issue-cell">
        <span class="issue-sum">{{ fix().summary(issue()) }}</span>
        <span class="issue-values">
          @for (v of fix().problemValues(issue()); track v.header) {
            <span class="issue-value">{{ v.header }}：<b>{{ v.value || ('importFix.blank' | transloco) }}</b></span>
          }
        </span>
      </td>
      <td class="act-col">
        <button type="button" class="btn btn-small btn-primary" [disabled]="fix().busy()" (click)="fix().edit(issue())">
          {{ 'importFix.check' | transloco }}
        </button>
      </td>
    }
  `,
  host: { class: 'issue-row' },
  styles: `
    /* 表の欄の決まり（余白・線・折り返さない）は、取り込みのページの CSS からは届かないので、ここにも書く（11/18） */
    :host td {
      padding: var(--space-xs) var(--space-sm);
      border-bottom: 1px solid var(--color-border);
      text-align: left;
      background: var(--color-danger-bg, #fdeceb);
      vertical-align: top;
    }
    td.val {
      white-space: nowrap;
    }
    .pick-col {
      width: 2.2em;
      text-align: center;
    }
    .cell-line {
      display: block;
    }
    .cell-line .bad {
      color: var(--color-danger-text);
      font-weight: 700;
    }
    td.num {
      padding-right: var(--space-md);
    }
    td.act-col {
      text-align: right;
      white-space: nowrap;
    }
    .issue-sum {
      display: block;
      font-weight: 600;
    }
    .issue-values {
      display: flex;
      flex-wrap: wrap;
      gap: 2px var(--space-sm);
      margin: 2px 0;
    }
    .issue-value {
      display: inline-block;
      margin: 2px 4px 2px 0;
      padding: 0 6px;
      border: 1px solid var(--color-danger-text);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      font-size: var(--font-sm);
    }
  `,
})
export class IssueRow {
  readonly issue = input.required<ImportIssue>();
  readonly fix = input.required<ImportIssues>();
  /** 表の列（行の番号のあと）ごとに、ファイルのどの見出しの値を出すか */
  readonly cols = input<readonly IssueCol[]>([]);
  /** cols がないとき：真ん中の欄の列の数 */
  readonly span = input(1);

  private readonly rec = computed(() => rowRecord(this.fix().table(), this.issue().line));
  private isBad(h: string): boolean {
    return this.issue().headers.some((p) => headerKey(p) === headerKey(h));
  }

  readonly cells = computed(() =>
    this.cols().map((lines) =>
      lines
        .map((l) => {
          const ln = normLine(l);
          const parts = ln.hs
            .map((h) => ({ header: h, value: this.fix().valueOf(this.rec(), h), bad: this.isBad(h) }))
            .filter((v) => v.value !== '' || v.bad);
          return { parts, sep: ln.sep, pre: ln.pre };
        })
        .filter((ln) => ln.parts.length > 0),
    ),
  );

  /** 表の列にない問題（最後の欄に「セイ：やまだ」と出す） */
  readonly extra = computed(() => {
    const shown = this.cols().flatMap((lines) => lines.flatMap((l) => normLine(l).hs));
    return this.issue()
      .headers.filter((h) => !shown.some((s) => headerKey(s) === headerKey(h)))
      .map((h) => ({ header: h, value: this.fix().valueOf(this.rec(), h) }));
  });
}
