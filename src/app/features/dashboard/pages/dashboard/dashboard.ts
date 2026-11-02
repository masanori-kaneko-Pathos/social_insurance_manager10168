import { Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../../../core/auth/auth.service';
import { LanguageService } from '../../../../core/i18n/language.service';
import { PREFECTURES } from '../../../../core/master/prefectures';
import { OfficeContext } from '../../../office/office-context.service';

@Component({
  selector: 'app-dashboard',
  imports: [TranslocoPipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  private readonly auth = inject(AuthService);
  private readonly context = inject(OfficeContext);
  private readonly language = inject(LanguageService);

  readonly profile = this.auth.profile;
  readonly office = this.context.current;

  readonly prefectureName = computed(() => {
    const p = PREFECTURES.find((x) => x.code === this.office()?.prefecture);
    if (!p) return '';
    return this.language.lang() === 'en' ? p.en : p.ja;
  });
}