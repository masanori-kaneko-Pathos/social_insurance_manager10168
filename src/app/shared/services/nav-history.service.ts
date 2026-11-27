import { Injectable, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { NavEntry, nameEntry, previousOf, PushMode, pushEntry } from '../logic/nav-history';

/**
 * アプリの中で見た画面を覚える（「‹ 前の画面」のリンクのため。11/25）
 * 画面の名前はルートの data.backName（i18n のキー）。data.backSkip の画面（編集・新規登録）は積まない
 * data.tabRoot の画面は、親のパスのタブ（事業所の設定 › マスタなど）。親と同じ画面として扱う（11/26）
 * 再読み込みすると忘れる（そのときは、各画面の決まった行き先に戻る）
 */
@Injectable({ providedIn: 'root' })
export class NavHistoryService {
  private readonly router = inject(Router);
  private readonly stack = signal<NavEntry[]>([]);
  /** 今の画面のパス */
  readonly currentPath = signal('');
  /** 今の画面の種類（ルートの形。年・月の切り替えを見分ける。11/27） */
  private currentPattern = '';
  /** 今の画面に、サイドバーかホームから来たか（そのときは「‹ 前の画面」を出さない。決まった行き先も出さない。11/27） */
  readonly arrivedFromRoot = signal(false);

  constructor() {
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => {
      const leaf = leafOf(this.router.routerState.snapshot.root);
      const path = leaf.data['tabRoot'] ? parentOf(pathOf(e.urlAfterRedirects)) : pathOf(e.urlAfterRedirects);
      // どう来たか：サイドバーのリンクは state.navRoot、「‹ 前の画面」は state.navBack。ホーム（/o/:id）からのリンクもサイドバーと同じ（11/27）
      const state = this.router.lastSuccessfulNavigation?.extras.state as { navRoot?: boolean; navBack?: boolean } | undefined;
      const fromHome = /^\/o\/[^/]+$/.test(this.currentPath()) && path !== this.currentPath();
      // 年・月だけが違う同じ画面への切り替え（定時決定の ‹ 2025年 › など）は、画面の中の切り替えと同じに扱う（11/27）
      const pattern = patternOf(leaf);
      const hasPeriod = leaf.params['year'] !== undefined || leaf.params['month'] !== undefined;
      const swap = hasPeriod && pattern === this.currentPattern && path !== this.currentPath() && !state?.navRoot && !state?.navBack;
      const mode: PushMode = swap ? 'swap' : state?.navRoot || fromHome ? 'root' : state?.navBack ? 'back' : 'push';
      // 同じ画面の中の切り替え（タブ・絞り込み・年月）は、来た道を変えない
      if (path !== this.currentPath() && !swap) this.arrivedFromRoot.set(mode === 'root');
      this.currentPath.set(path);
      this.currentPattern = pattern;
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
      this.stack.update((s) => pushEntry(s, { path, url: e.urlAfterRedirects, name: { key, params } }, mode));
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

/** 最後の段を外したパス（/o/x/settings/masters → /o/x/settings） */
function parentOf(path: string): string {
  return path.replace(/\/[^/]+\/?$/, '');
}

/** ルートの形（/o/:officeId/regular/:year など。値は入れない） */
function patternOf(leaf: ActivatedRouteSnapshot): string {
  return leaf.pathFromRoot.map((r) => r.routeConfig?.path ?? '').filter((p) => p !== '').join('/');
}

function leafOf(r: ActivatedRouteSnapshot): ActivatedRouteSnapshot {
  let x = r;
  while (x.firstChild) x = x.firstChild;
  return x;
}
