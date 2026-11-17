import { Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ImportIssue, ImportIssues } from './import-issues';

/**
 * 表の中の問題の行（11/17）：<tr app-issue-row [issue]="…" [fix]="fix" [span]="列の数 − 2">
 * 行の番号・その行の中身（社員番号・氏名など）と問題・「直す」。読めた行と同じ位置に出るので、前後の行と見比べられる
 */
@Component({
  selector: 'tr[app-issue-row]',
  imports: [TranslocoPipe],
  template: `
    <td class="num">{{ issue().line }}</td>
    <td [attr.colspan]="span()" class="issue-cell">
      <span class="issue-sum">{{ fix().summary(issue()) }}</span>
      @for (m of issue().messages; track $index) {
        <span class="issue-msg">{{ m }}</span>
      }
    </td>
    <td class="issue-act">
      <button type="button" class="btn btn-small btn-primary" [disabled]="fix().busy()" (click)="fix().edit(issue())">
        {{ 'importFix.fix' | transloco }}
      </button>
    </td>
  `,
  host: { class: 'issue-row' },
  styles: `
    :host td {
      background: var(--color-danger-bg, #fdeceb);
      vertical-align: top;
    }
    .issue-sum {
      display: block;
      font-weight: 600;
      color: var(--color-text);
    }
    .issue-msg {
      display: block;
      color: var(--color-danger-text);
    }
    .issue-act {
      text-align: right;
      white-space: nowrap;
    }
  `,
})
export class IssueRow {
  readonly issue = input.required<ImportIssue>();
  readonly fix = input.required<ImportIssues>();
  /** 真ん中の欄が何列ぶんか（表の列の数 − 2） */
  readonly span = input(1);
}

/** 読めた行の中の「直す」（その行に問題もあるとき） */
@Component({
  selector: 'app-fix-button',
  imports: [TranslocoPipe],
  template: `
    <button type="button" class="btn btn-small btn-primary fix-btn" [disabled]="fix().busy()" (click)="fix().edit(issue())">
      {{ 'importFix.fix' | transloco }}
    </button>
  `,
  styles: `
    .fix-btn {
      margin-top: 4px;
    }
  `,
})
export class FixButton {
  readonly issue = input.required<ImportIssue>();
  readonly fix = input.required<ImportIssues>();
}
