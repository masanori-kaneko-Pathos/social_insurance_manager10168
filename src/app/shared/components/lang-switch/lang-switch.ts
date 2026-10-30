import { Component, inject } from '@angular/core';
import { LanguageService } from '../../../core/i18n/language.service';

@Component({
  selector: 'app-lang-switch',
  templateUrl: './lang-switch.html',
  styleUrl: './lang-switch.css',
})
export class LangSwitch {
  readonly language = inject(LanguageService);
}