import { Injectable, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { NavEntry, nameEntry, previousOf, pushEntry } from '../logic/nav-history';

/**
 * アプリの中で見た画面を覚える（「‹ 前の画面」のリンクのため。11/25）
 * 画面の名前はルートの data.backName（i18n のキー）。data.backSkip の画面（編集・新規登録）は積まない
 * 再読み込みすると忘れる（そのときは、各画面の決まった行き先に戻る）
 */
@Injectable({ providedIn: 'root' })
export class NavHistoryService {
  private readonly router = inject(Router);
  private readonly stack = signal<NavEntry[]>([]);
  /** 今の画面のパス */
  readonly currentPath = signal('');

  constructor() {
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => {
      const path = pathOf(e.urlAfterRedirects);
      this.currentPath.set(path);
      const leaf = leafOf(this.router.routerState.snapshot.root);
      const key = leaf.data['backName'] as string | undefined;
      if (!key || leaf.data['backSkip']) return;
      // 名前に差し込む値（年月の画面の「2026年7月払い」など）
      const params: Record<string, string> = {};
      const month = leaf.params['month'] as string | undefined;
      if (month && /^\d{4}-\d{2}$/.test(month)) {
        params['y'] = month.slice(0, 4);
        params['m'] = String(Number(month.slice(5)));
      }
      if (leaf.params['year']) params['year'] = leaf.params['year'];
      this.stack.update((s) => pushEntry(s, { path, url: e.urlAfterRedirects, name: { key, params } }));
    });
  }

  /** 今の画面の前の画面（なければ null） */
  previous(): NavEntry | null {
    return previousOf(this.stack(), this.currentPath());
  }

  /** 今の画面の名前を、画面が後から決める（従業員のページの氏名など） */
  nameCurrent(text: string): void {
    this.stack.update((s) => nameEntry(s, this.currentPath(), text));
  }
}

function pathOf(url: string): string {
  return url.split(/[?#]/)[0];
}

function leafOf(r: ActivatedRouteSnapshot): ActivatedRouteSnapshot {
  let x = r;
  while (x.firstChild) x = x.firstChild;
  return x;
}
