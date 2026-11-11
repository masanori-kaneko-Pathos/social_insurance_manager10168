import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
  isDevMode,
  inject,
  provideAppInitializer,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { LanguageService } from './core/i18n/language.service';
import { routes } from './app.routes';
import { provideHttpClient } from '@angular/common/http';
import { TranslocoHttpLoader } from './transloco-loader';
import { provideTransloco } from '@jsverse/transloco';
import { LANG_CODES } from './core/i18n/languages';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAppInitializer(() => inject(LanguageService).init()),
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(),
    provideTransloco({
      config: {
        availableLangs: [...LANG_CODES],
        defaultLang: 'ja',
        // Remove this option if your application doesn't support changing language in runtime.
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
        // 空の文字列 "" も「訳がある」として扱う（英語では月の「月」などを付けないため）
        missingHandler: { allowEmpty: true },
      },
      loader: TranslocoHttpLoader,
    }),
  ],
};
