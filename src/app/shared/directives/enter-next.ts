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

/** 欄にカーソルを置き、画面の下のほう・上に隠れていれば、画面を少し動かして真ん中に出す */
function focusField(el: HTMLElement | undefined): boolean {
  if (!el) return false;
  el.focus({ preventScroll: true });
  if (el instanceof HTMLInputElement && el.type !== 'checkbox') el.select();
  const r = el.getBoundingClientRect();
  if (r.bottom > window.innerHeight * 0.7 || r.top < 80) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

/**
 * from の次の欄へ移る（同じ form の中で）。部品が自分で Enter を扱うときに使う（11/17）
 * 例：部署の欄が空のまま Enter → 部署の欄を飛ばして、その下の所在地へ
 */
export function focusNextField(from: HTMLElement): boolean {
  const root = from.closest('form') ?? document.body;
  const all = Array.from(root.querySelectorAll<HTMLElement>(FIELDS)).filter(usable);
  const i = all.indexOf(from);
  return i >= 0 && focusField(all[i + 1]);
}

/**
 * Enter で次の欄へ（最後の欄では何もしない＝ Enter で送信しない）
 * appEnterNext="grid" なら、表の中で矢印キーでも上下左右のセルへ（表計算ソフトと同じ動き）
 * - 左右の矢印は、カーソルが文字の端にあるときだけ（文字の中の移動を邪魔しない）
 * - 選択肢（select）の上下は、選択肢を変える動きのまま
 * - 日本語の変換中の Enter は、変換の確定なので移らない
 * - 移った先が画面の下のほうなら、画面を少し動かして真ん中に出す（11/17）
 * - 選択肢（select）は、Enter で一覧を開き、矢印で選んで Enter で決めると次の欄へ（11/17）
 *   一覧を開けないブラウザでは、今までどおり Enter で次の欄へ
 */
@Directive({
  selector: '[appEnterNext]',
  host: { '(keydown)': 'onKeydown($event)', '(change)': 'onChange($event)' },
})
export class EnterNext {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly appEnterNext = input<'' | 'grid'>('');
  /** Enter で一覧を開いた選択肢（一覧で選んで決めたら次の欄へ移る） */
  private readonly picking = new WeakSet<HTMLSelectElement>();

  onKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (!target.matches(FIELDS) || e.isComposing || e.keyCode === 229 || e.altKey || e.ctrlKey || e.metaKey) return;
    // 欄が自分で Enter を扱った（部署の読みへ移る・組合の名前から履歴へ動く など）ときは、何もしない（11/17）
    if (e.defaultPrevented) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (target instanceof HTMLSelectElement && !this.picking.has(target) && this.openPicker(target)) return;
      if (target instanceof HTMLSelectElement) this.picking.delete(target);
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

  /** 選択肢の一覧を開く（開けたら true） */
  private openPicker(sel: HTMLSelectElement): boolean {
    const s = sel as HTMLSelectElement & { showPicker?: () => void };
    if (typeof s.showPicker !== 'function') return false;
    try {
      s.showPicker();
      this.picking.add(sel);
      return true;
    } catch {
      return false;
    }
  }

  /** 一覧で選んで決めた → 次の欄へ */
  onChange(e: Event): void {
    const t = e.target;
    if (t instanceof HTMLSelectElement && this.picking.has(t)) {
      this.picking.delete(t);
      this.moveBy(t, 1);
    }
  }

  private fields(root: ParentNode = this.host.nativeElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FIELDS)).filter(usable);
  }

  private focus(el: HTMLElement | undefined): boolean {
    return focusField(el);
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
