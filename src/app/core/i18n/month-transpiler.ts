import { Injectable } from '@angular/core';
import { DefaultTranspiler, TranspileParams } from '@jsverse/transloco';
import { yearMonthParams } from '../../shared/utils/year-month-text';

/**
 * 翻訳の引数に年月（YYYY-MM）がそのまま入っていたら、その言語の言葉（2024年11月 など）にして埋める（11/27）
 * 形はその言語の翻訳の format.yearMonth を使う（言語を切り替えれば形も変わる）
 * app.config.ts の providers で provideTransloco の後に provideTranslocoTranspiler(MonthTranspiler) を置く
 */
@Injectable()
export class MonthTranspiler extends DefaultTranspiler {
  override transpile(p: TranspileParams): unknown {
    const template = (p.translation as Record<string, unknown> | undefined)?.['format.yearMonth'];
    if (typeof template === 'string' && p.params) {
      return super.transpile({ ...p, params: yearMonthParams(p.params as Record<string, unknown>, template) });
    }
    return super.transpile(p);
  }
}
