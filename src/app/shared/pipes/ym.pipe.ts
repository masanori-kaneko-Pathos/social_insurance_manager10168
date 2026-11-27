import { inject, Pipe, PipeTransform } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { YEAR_MONTH_RE } from '../utils/year-month-text';

/**
 * 年月（YYYY-MM）を画面の言葉にする（11/27）：{{ r.month | ym }} → 2024年11月
 * 年月でない値（日付・空など）はそのまま返すので、日付の欄に付けても変わらない
 * 言語の切り替えに合わせるため pure: false（軽い置き換えだけ）
 */
@Pipe({ name: 'ym', pure: false })
export class YmPipe implements PipeTransform {
  private readonly transloco = inject(TranslocoService);

  transform(value: string | null | undefined): string {
    if (value == null) return '';
    if (!YEAR_MONTH_RE.test(value)) return value;
    const [y, mm] = value.split('-');
    const m = Number(mm);
    return this.transloco.translate('format.yearMonth', { y, mm, m, mon: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] });
  }
}
