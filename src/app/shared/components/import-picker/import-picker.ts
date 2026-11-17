import { Component, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { IMPORT_ACCEPT } from '../../import/parse';

/**
 * 取り込みのファイルを選ぶ行（11/17。ファイルの取り込みのページの、どの区分もこれを使う）
 * [ファイルを選ぶ]  ひな形をダウンロード  列の書き方 ▸
 * - ひな形：ボタン1つで落とす（template）か、開いて中身を出す（templateDrawer。給与の期間を選んで出力・マイナンバーの書き出し）
 * - 列の書き方：開くと <div columns> の中身を出す
 */
@Component({
  selector: 'app-import-picker',
  imports: [TranslocoPipe],
  templateUrl: './import-picker.html',
  styleUrl: './import-picker.css',
})
export class ImportPicker {
  readonly accept = input<string>(IMPORT_ACCEPT);
  readonly busy = input(false);
  /** 下の小さい説明 */
  readonly hintKey = input('importMap.fileHint');
  /** ひな形のボタンの文言（null なら出さない） */
  readonly templateKey = input<string | null>('employeeCsv.template');
  /** ひな形を「開く」形にする（中身は <div template>） */
  readonly templateDrawer = input(false);
  /** 列の書き方を出すか（中身は <div columns>） */
  readonly columns = input(true);

  readonly picked = output<Event>();
  readonly template = output<void>();

  readonly open = signal<'template' | 'columns' | null>(null);

  toggle(which: 'template' | 'columns'): void {
    this.open.set(this.open() === which ? null : which);
  }

  onTemplate(): void {
    if (this.templateDrawer()) this.toggle('template');
    else this.template.emit();
  }
}
