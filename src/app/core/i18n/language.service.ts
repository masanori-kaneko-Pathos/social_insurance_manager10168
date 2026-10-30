import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';

export type Lang = 'ja' | 'en';
const STORAGE_KEY = 'shaho.lang';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService);

  /** 現在の言語（画面で使う） */
  readonly lang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

  /** 起動時に1回だけ呼ぶ：保存された言語があれば戻す */
  init(): void {
    const saved = this.read();
    if (saved) this.transloco.setActiveLang(saved);
    document.documentElement.lang = this.transloco.getActiveLang();
  }

  set(lang: Lang): void {
    this.transloco.setActiveLang(lang);
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // 保存できなくても動作は続ける
    }
  }

  private read(): Lang | null {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === 'ja' || v === 'en' ? v : null;
    } catch {
      return null;
    }
  }
}