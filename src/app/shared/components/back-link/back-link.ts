import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { NavHistoryService } from '../../services/nav-history.service';

/**
 * 見出しの上の「‹ 前の画面」（11/25）
 * アプリの中で前に見た画面があればそこへ（タブ・絞り込みもそのまま）。なければ（URL を直接開いた・再読み込み）決まった行き先へ
 */
@Component({
  selector: 'app-back-link',
  imports: [TranslocoPipe],
  template: `
    @if (target(); as t) {
      <a class="back" [href]="t.href" (click)="go($event, t.href)"
        >‹ {{ t.text ?? (t.key | transloco: t.params) }}</a
      >
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .back {
      display: inline-block;
      margin-bottom: var(--space-sm);
      font-size: var(--font-sm);
      color: var(--color-text-sub);
      text-decoration: none;
    }
    .back:hover {
      color: var(--color-text);
      text-decoration: underline;
    }
  `,
})
export class BackLink {
  private readonly router = inject(Router);
  private readonly history = inject(NavHistoryService);

  /** 前の画面がないときの行き先（routerLink と同じ形。null ならリンクを出さない） */
  readonly fallback = input<readonly unknown[] | string | null>(null);
  /** そのときの名前（i18n のキー） */
  readonly fallbackName = input<string>('');
  readonly fallbackParams = input<Record<string, unknown> | undefined>(undefined);

  readonly target = computed(() => {
    this.history.currentPath(); // 画面が変わったら見直す
    const prev = this.history.previous();
    if (prev) return { href: prev.url, key: prev.name.key, params: prev.name.params, text: prev.text ?? null };
    const f = this.fallback();
    if (!f) return null;
    const tree = typeof f === 'string' ? this.router.parseUrl(f) : this.router.createUrlTree(f as unknown[]);
    return { href: this.router.serializeUrl(tree), key: this.fallbackName(), params: this.fallbackParams(), text: null };
  });

  go(event: MouseEvent, href: string): void {
    // 新しいタブで開く（Ctrl・中ボタン）はブラウザに任せる
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    void this.router.navigateByUrl(href);
  }
}
