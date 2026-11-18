import { Injectable, computed, signal } from '@angular/core';

export type ThemePref = 'light' | 'dark' | 'system';
export const THEME_PREFS: readonly ThemePref[] = ['light', 'dark', 'system'];
const STORAGE_KEY = 'shaho.theme';

/**
 * ライト／ダーク／システムに合わせる
 * 選んだものはブラウザに覚えさせる（アカウントには保存しない。会社のPCと家のPCで変えたいことがあるため）
 * <html data-theme="dark"> を付け外しし、色は styles.css の変数で切り替える
 * 最初の1回は index.html の小さなスクリプトが先に付ける（読み込み中に白く光らないように）
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  private readonly systemDark = signal(this.media?.matches ?? false);
  readonly pref = signal<ThemePref>(this.read());
  readonly dark = computed(() => (this.pref() === 'system' ? this.systemDark() : this.pref() === 'dark'));

  constructor() {
    this.media?.addEventListener('change', (e) => {
      this.systemDark.set(e.matches);
      this.switchTo();
    });
    this.apply();
  }

  set(pref: ThemePref): void {
    this.pref.set(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // 保存できない環境（プライベートブラウズなど）では、この画面の間だけ
    }
    this.switchTo();
  }

  /**
   * 切り替えのときだけ、画面全体を 0.15 秒で重ねて入れ替える（11/18）
   * ページの切り替えと同じ View Transitions を使う（要素ごとに色を動かすと、大きな表で重くなるため）
   * 対応していないブラウザ・色が変わらないとき・動きを減らす設定の人は、すぐ切り替える
   */
  private switchTo(): void {
    const next = this.dark() ? 'dark' : 'light';
    const root = document.documentElement;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (root.dataset['theme'] === next || !doc.startViewTransition || reduce) {
      this.apply();
      return;
    }
    root.classList.add('theme-switching');
    doc
      .startViewTransition(() => this.apply())
      .finished.finally(() => root.classList.remove('theme-switching'));
  }

  private read(): ThemePref {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
    } catch {
      return 'system';
    }
  }

  private apply(): void {
    document.documentElement.dataset['theme'] = this.dark() ? 'dark' : 'light';
  }
}
