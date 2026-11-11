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
      this.apply();
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
    this.apply();
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
