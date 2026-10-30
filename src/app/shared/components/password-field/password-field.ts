import { Component, contentChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { PasswordInputDirective } from './password-input.directive';

@Component({
  selector: 'app-password-field',
  imports: [TranslocoPipe],
  templateUrl: './password-field.html',
  styleUrl: './password-field.css',
  host: { class: 'password-field' },
})
export class PasswordField {
  /** 中に入れた <input appPasswordInput> を探す */
  readonly input = contentChild(PasswordInputDirective);
}