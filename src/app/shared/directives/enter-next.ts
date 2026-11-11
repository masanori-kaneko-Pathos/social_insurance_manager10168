import { Directive, ElementRef, inject, input } from '@angular/core';

/** 移る先にする欄（見えていて、押せて、書き換えられるもの） */
const FIELDS = 'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=radio]), select';

function usable(el: HTMLElement): boolean {
  const f = el as HTMLInputElement;
  return !f.disabled && !f.readOnly && el.offsetParent !== null;
}

/** 文字の欄でカーソルが端にあるか（数字の欄など、位置が取れないものは端とみなす） */
function atEdge(el: HTMLElement, dir: 'left' | 'right'): boolean {
  const f = el as HTMLInputElement;
  try {
    if (f.selectionStart == null || f.selectionEnd == null) return true;
    if (f.selectionStart !== f.selectionEnd) return false; // 選んでいる最中は文字の中を動く
    return dir === 'left' ? f.selectionStart === 0 : f.selectionEnd === f.value.length;
  } catch {
    return true;
  }
}

/**
 * Enter で次の欄へ（最後の欄では何もしない＝ Enter で送信しない）
 * appEnterNext="grid" なら、表の中で矢印キーでも上下左右のセルへ（表計算ソフトと同じ動き）
 * - 左右の矢印は、カーソルが文字の端にあるときだけ（文字の中の移動を邪魔しない）
 * - 選択肢（select）の上下は、選択肢を変える動きのまま
 * - 日本語の変換中の Enter は、変換の確定なので移らない
 */
@Directive({
  selector: '[appEnterNext]',
  host: { '(keydown)': 'onKeydown($event)' },
})
export class EnterNext {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly appEnterNext = input<'' | 'grid'>('');

  onKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (!target.matches(FIELDS) || e.isComposing || e.keyCode === 229 || e.altKey || e.ctrlKey || e.metaKey) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.moveBy(target, 1);
      return;
    }
    if (this.appEnterNext() !== 'grid') return;
    const isSelect = target.tagName === 'SELECT';
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowDown':
        if (isSelect) return;
        if (this.moveVertical(target, e.key === 'ArrowUp' ? -1 : 1)) e.preventDefault();
        return;
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (!isSelect && !atEdge(target, e.key === 'ArrowLeft' ? 'left' : 'right')) return;
        if (this.moveInRow(target, e.key === 'ArrowLeft' ? -1 : 1)) e.preventDefault();
        return;
      }
    }
  }

  private fields(root: ParentNode = this.host.nativeElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FIELDS)).filter(usable);
  }

  private focus(el: HTMLElement | undefined): boolean {
    if (!el) return false;
    el.focus();
    if (el instanceof HTMLInputElement && el.type !== 'checkbox') el.select();
    return true;
  }

  private moveBy(from: HTMLElement, diff: number): boolean {
    const all = this.fields();
    const i = all.indexOf(from);
    return i >= 0 && this.focus(all[i + diff]);
  }

  /** 同じ行（tr）の中の前後の欄 */
  private moveInRow(from: HTMLElement, diff: number): boolean {
    const row = from.closest('tr');
    if (!row) return this.moveBy(from, diff);
    const cells = this.fields(row);
    return this.focus(cells[cells.indexOf(from) + diff]);
  }

  /** 上下の行の、同じ列（td の位置）の欄。その行に欄がなければ、さらに先の行へ */
  private moveVertical(from: HTMLElement, diff: number): boolean {
    const cell = from.closest('td, th') as HTMLTableCellElement | null;
    const row = from.closest('tr');
    if (!cell || !row) return false;
    const col = cell.cellIndex;
    const rows = Array.from(this.host.nativeElement.querySelectorAll('tr'));
    for (let i = rows.indexOf(row) + diff; i >= 0 && i < rows.length; i += diff) {
      const target = (rows[i] as HTMLTableRowElement).cells[col];
      const field = target ? this.fields(target)[0] : undefined;
      if (field) return this.focus(field);
    }
    return false;
  }
}
