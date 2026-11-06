import { Directive, ElementRef, HostListener, inject } from '@angular/core';
import { toHalfDigits } from '../utils/text';

/** 文字を打つ入力欄の種類（チェックボックス・日付などは対象外） */
const TEXT_TYPES = new Set(['', 'text', 'search', 'tel', 'email', 'number', 'url']);

/**
 * 全角の数字（０〜９）を半角に直す。すべての input・textarea に付く
 * 打っている最中は触らず、欄から離れた時と日本語入力を確定した時に直す（変換を壊さないため）
 * 使い方：コンポーネントの imports に HalfWidthDigits を足すだけ
 */
@Directive({ selector: 'input, textarea' })
export class HalfWidthDigits {
  private readonly el = inject<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(ElementRef);

  @HostListener('blur')
  @HostListener('compositionend')
  fix(): void {
    const el = this.el.nativeElement;
    if (el instanceof HTMLInputElement && !TEXT_TYPES.has(el.getAttribute('type') ?? '')) return;
    // パスワードは「表示」で type が text になっても触らない（打った文字そのものが大事）
    if (el.hasAttribute('appPasswordInput')) return;
    const next = toHalfDigits(el.value);
    if (next === el.value) return;
    // 1文字ずつの置き換えなので長さは変わらない → カーソルの位置を保つ
    const start = el.selectionStart;
    const end = el.selectionEnd;
    el.value = next;
    if (document.activeElement === el && start !== null && end !== null) {
      el.setSelectionRange(start, end);
    }
    // フォームに新しい値を知らせる
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
