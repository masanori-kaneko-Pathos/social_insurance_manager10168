import { Component, ElementRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from '../../../../core/i18n/language.service';
import { OfficeContext } from '../../office-context.service';
import { officeDisplayName } from '../../office-settings';

@Component({
  selector: 'app-office-switcher',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './office-switcher.html',
  styleUrl: './office-switcher.css',
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'close()',
  },
})
export class OfficeSwitcher {
  readonly context = inject(OfficeContext);
  private readonly language = inject(LanguageService);

  /** 英語の画面で、英語の名前があればそちら */
  nameOf(o: { name: string; nameEn?: string | null } | null | undefined): string {
    return o ? officeDisplayName(o, this.language.lang()) : '';
  }
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly open = signal(false);

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }

  onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }
}