import { Directive, signal } from '@angular/core';

/** <input> に付けると、表示・非表示を切り替えられるパスワード欄になる */
@Directive({
  selector: 'input[appPasswordInput]',
  host: { '[type]': 'visible() ? "text" : "password"' },
})
export class PasswordInputDirective {
  readonly visible = signal(false);

  toggle(): void {
    this.visible.update((v) => !v);
  }
}