import { Component, inject, signal, computed } from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { AuthService } from '../../../../core/auth/auth.service';
import { LangSwitch } from '../../../../shared/components/lang-switch/lang-switch';
import { OfficeSwitcher } from '../../components/office-switcher/office-switcher';
import { OfficeContext } from '../../office-context.service';
import { Icon } from '../../../../shared/components/icon/icon';
import { todayLocal } from '../../../../shared/utils/date';
import { latestPaidMonth } from '../../../payrolls/logic/payroll-rows';
import { regularYearOf } from '../../../payrolls/logic/regular';
import { payrollOf } from '../../office-settings';

@Component({
  selector: 'app-office-shell',
  imports: [RouterOutlet, TranslocoPipe, LangSwitch, OfficeSwitcher, RouterLink, RouterLinkActive, Icon],
  templateUrl: './office-shell.html',
  styleUrl: './office-shell.css',
})
export class OfficeShell {
  private readonly auth = inject(AuthService);
  private readonly context = inject(OfficeContext);
  private readonly router = inject(Router);

  readonly profile = this.auth.profile;
  readonly officeId = computed(() => this.context.current()?.id ?? '');
  readonly loggingOut = signal(false);

  /** 定時決定の年（6月の支払日を過ぎていれば今年。給与の実績の画面と同じ決め方） */
  readonly regularYear = computed(() => {
    const office = this.context.current();
    return office ? regularYearOf(latestPaidMonth(todayLocal(), payrollOf(office))) : 0;
  });

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