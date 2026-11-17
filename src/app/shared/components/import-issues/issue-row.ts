import { Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { headerKey } from '../../import/column-map';
import { rowRecord } from '../../import/row-fix';
import { ImportIssue, ImportIssues } from './import-issues';

/**
 * 表の中の問題の行（11/17）：<tr app-issue-row [issue]="…" [fix]="fix" [cols]="表の列ごとの見出し">
 * 取り込んだときと同じ列に、ファイルに書いてあった値を並べる（問題の値は赤く太く）。説明は「直す」の窓で読む
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
        <td>
          @for (v of c; track v.header) {
            <span class="cell-value" [class.bad]="v.bad">{{ v.value || ('importFix.blank' | transloco) }}</span>
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
    :host td {
      background: var(--color-danger-bg, #fdeceb);
      vertical-align: top;
    }
    .pick-col {
      width: 2.2em;
      text-align: center;
    }
    .cell-value {
      display: block;
    }
    .cell-value.bad {
      color: var(--color-danger-text);
      font-weight: 700;
    }
    td.num {
      padding-right: var(--space-md);
    }
    .act-col {
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
  readonly cols = input<readonly (readonly string[])[]>([]);
  /** cols がないとき：真ん中の欄の列の数 */
  readonly span = input(1);

  private readonly rec = computed(() => rowRecord(this.fix().table(), this.issue().line));
  private isBad(h: string): boolean {
    return this.issue().headers.some((p) => headerKey(p) === headerKey(h));
  }

  readonly cells = computed(() =>
    this.cols().map((hs) =>
      hs
        .map((h) => ({ header: h, value: this.fix().valueOf(this.rec(), h), bad: this.isBad(h) }))
        .filter((v) => v.value !== '' || v.bad),
    ),
  );

  /** 表の列にない問題（最後の欄に「セイ：やまだ」と出す） */
  readonly extra = computed(() => {
    const shown = this.cols().flat();
    return this.issue()
      .headers.filter((h) => !shown.some((s) => headerKey(s) === headerKey(h)))
      .map((h) => ({ header: h, value: this.fix().valueOf(this.rec(), h) }));
  });
}
