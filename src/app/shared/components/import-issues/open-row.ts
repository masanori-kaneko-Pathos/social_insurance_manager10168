import { Directive, input } from '@angular/core';
import { ImportIssues } from './import-issues';

/**
 * 取り込みの確認の表の行を押すと、その行の窓を開く（11/27。「詳細」ボタンをやめた。給与の月の表と同じ動き）
 * <tr [appOpenRow]="x.line" [openFix]="fix">。行の中のチェック・リンク・ボタンを押したときは開かない
 * キーボードは行に移って Enter・スペース
 */
@Directive({
  selector: 'tr[appOpenRow]',
  host: {
    class: 'open-row',
    tabindex: '0',
    '(click)': 'onClick($event)',
    '(keydown)': 'onKey($event)',
  },
})
export class OpenRow {
  readonly appOpenRow = input.required<number>();
  readonly openFix = input.required<ImportIssues>();

  onClick(event: MouseEvent): void {
    const el = event.target as HTMLElement | null;
    if (el?.closest('a, button, input, select, textarea, label')) return;
    if (window.getSelection()?.toString()) return;
    if (this.openFix().busy()) return;
    this.openFix().openLine(this.appOpenRow());
  }

  onKey(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (!this.openFix().busy()) this.openFix().openLine(this.appOpenRow());
  }
}
