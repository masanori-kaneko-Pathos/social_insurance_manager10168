import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { auth } from '../firebase';
import { UserProfileService } from '../auth/user-profile.service';

import { isLang, Lang, LANGUAGES } from './languages';

// 言語の一覧は languages.ts（ここでは Lang を今までどおり使えるよう、そのまま渡す）
export type { Lang };
const STORAGE_KEY = 'shaho.lang';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService);
  private readonly profiles = inject(UserProfileService);

  /** 現在の言語（画面で使う） */
  readonly lang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

  /** 使える言語（切り替えのボタンに並べる） */
  readonly languages = LANGUAGES;

  /** 起動時に1回だけ呼ぶ：保存された言語があれば戻す */
  init(): void {
    const saved = this.read();
    if (saved) this.transloco.setActiveLang(saved);
    document.documentElement.lang = this.transloco.getActiveLang();
  }

  /** ボタンで切り替えたとき：ログイン中なら users にも保存 */
  set(lang: Lang): void {
    this.apply(lang);
    const uid = auth.currentUser?.uid;
    if (uid && this.profiles.profile()?.uid === uid) {
      this.profiles.updateLang(uid, lang).catch((err) => console.error(err));
    }
  }

  /** ログイン時：users に保存された言語を反映（書き戻さない） */
  applyFromProfile(lang: Lang): void {
    this.apply(lang);
  }

  private apply(lang: Lang): void {
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
      return isLang(v) ? v : null;
    } catch {
      return null;
    }
  }
}