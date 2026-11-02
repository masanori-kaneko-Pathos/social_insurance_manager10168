import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../../../core/auth/auth.service';
import { LangSwitch } from '../../../../shared/components/lang-switch/lang-switch';
import { OfficeSwitcher } from '../../components/office-switcher/office-switcher';
import { OfficeContext } from '../../office-context.service';

@Component({
  selector: 'app-office-shell',
  imports: [RouterOutlet, TranslocoPipe, LangSwitch, OfficeSwitcher],
  templateUrl: './office-shell.html',
  styleUrl: './office-shell.css',
})
export class OfficeShell {
  private readonly auth = inject(AuthService);
  private readonly context = inject(OfficeContext);
  private readonly router = inject(Router);

  readonly profile = this.auth.profile;
  readonly loggingOut = signal(false);

  async logout(): Promise<void> {
    this.loggingOut.set(true);
    try {
      this.context.clear(); // 次の人に前の事業所が残らないように
      await this.auth.logout();
      await this.router.navigateByUrl('/login');
    } finally {
      this.loggingOut.set(false);
    }
  }
}