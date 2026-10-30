import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../../../core/auth/auth.service';
import { LangSwitch } from '../../../../shared/components/lang-switch/lang-switch';

@Component({
  selector: 'app-home',
  imports: [TranslocoPipe, LangSwitch, RouterLink ],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly profile = this.auth.profile;
  readonly loggingOut = signal(false);

  async logout(): Promise<void> {
    this.loggingOut.set(true);
    try {
      await this.auth.logout();
      await this.router.navigateByUrl('/login');
    } finally {
      this.loggingOut.set(false);
    }
  }
}