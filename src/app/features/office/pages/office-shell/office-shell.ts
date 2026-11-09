import { Component, inject, computed } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { OfficeSwitcher } from '../../components/office-switcher/office-switcher';
import { AccountMenu } from '../../components/account-menu/account-menu';
import { OfficeContext } from '../../office-context.service';
import { Icon } from '../../../../shared/components/icon/icon';
import { todayLocal } from '../../../../shared/utils/date';
import { latestPaidMonth } from '../../../payrolls/logic/payroll-rows';
import { regularYearOf } from '../../../payrolls/logic/regular';
import { payrollOf } from '../../office-settings';

@Component({
  selector: 'app-office-shell',
  imports: [RouterOutlet, TranslocoPipe, OfficeSwitcher, AccountMenu, RouterLink, RouterLinkActive, Icon],
  templateUrl: './office-shell.html',
  styleUrl: './office-shell.css',
})
export class OfficeShell {
  private readonly context = inject(OfficeContext);

  readonly officeId = computed(() => this.context.current()?.id ?? '');

  /** 定時決定の年（6月の支払日を過ぎていれば今年。給与の実績の画面と同じ決め方） */
  readonly regularYear = computed(() => {
    const office = this.context.current();
    return office ? regularYearOf(latestPaidMonth(todayLocal(), payrollOf(office))) : 0;
  });
}