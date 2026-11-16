import { Directive, ElementRef, inject } from '@angular/core';

/**
 * <details> のメニューを、外を押したとき・Esc・中の項目を押したときに閉じる（11/16）
 * 使い方：<details class="menu" appCloseOnOutside>
 */
@Directive({
  selector: 'details[appCloseOnOutside]',
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'close()',
  },
})
export class CloseOnOutside {
  private readonly el = inject<ElementRef<HTMLDetailsElement>>(ElementRef);

  onDocumentClick(event: MouseEvent): void {
    const d = this.el.nativeElement;
    if (!d.open) return;
    const target = event.target as Node | null;
    // 外を押した → 閉じる。中のメニューの項目（button）を押した → 選んだので閉じる
    if (!target || !d.contains(target)) this.close();
    else if ((target as Element).closest?.('[role="menuitem"]')) this.close();
  }

  close(): void {
    this.el.nativeElement.open = false;
  }
}
