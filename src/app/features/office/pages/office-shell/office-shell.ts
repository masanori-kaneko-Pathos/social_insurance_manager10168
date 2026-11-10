import { Component, computed, effect, inject } from '@angular/core';
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
import { Bell } from '../../../../shared/components/bell/bell';
import { TodoBadgeService } from '../../../dashboard/todo-badge.service';
import { ToastService } from '../../../../shared/services/toast.service';

@Component({
  selector: 'app-office-shell',
  imports: [RouterOutlet, TranslocoPipe, OfficeSwitcher, AccountMenu, RouterLink, RouterLinkActive, Icon, Bell],
  templateUrl: './office-shell.html',
  styleUrl: './office-shell.css',
})
export class OfficeShell {
  readonly context = inject(OfficeContext);
  readonly badge = inject(TodoBadgeService);
  readonly toast = inject(ToastService);

  /** ベルの数：To-do（数えていれば）＋確認待ちの依頼 */
  readonly bellCount = computed(() => (this.badge.todoCount() ?? 0) + this.badge.requestCount());

  readonly officeId = computed(() => this.context.current()?.id ?? '');

  constructor() {
    // 事業所が変わったら、ベルの数を数え直す（To-do の件数は To-do リストが入れる）
    effect(() => {
      const id = this.officeId();
      if (id) void this.badge.refresh(id, this.context.isAdmin());
    });
  }

  /** 定時決定の年（6月の支払日を過ぎていれば今年。給与の実績の画面と同じ決め方） */
  readonly regularYear = computed(() => {
    const office = this.context.current();
    return office ? regularYearOf(latestPaidMonth(todayLocal(), payrollOf(office))) : 0;
  });
}