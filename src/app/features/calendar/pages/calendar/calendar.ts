import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { shiftMonth, todayLocal, toYearMonth } from '../../../../shared/utils/date';
import { TodoBadgeService } from '../../../dashboard/todo-badge.service';
import { OfficeContext } from '../../../office/office-context.service';
import { payrollOf } from '../../../office/office-settings';
import { latestPaidMonth } from '../../../payrolls/logic/payroll-rows';
import { regularYearOf } from '../../../payrolls/logic/regular';
import { dueDateOf } from '../../../premiums/logic/notice-check';
import { monthlyTasks, TaskLink, upcomingMonths, YearTask, yearTasks } from '../../logic/year-tasks';

/**
 * 1年の業務の暦：今月から12か月、月ごとにやることと、その画面への入口
 * To-do は「その日が来たらやること」、暦は「これから1年の見通し」。読み込みはない（事業所の設定だけで作る）
 */
@Component({
  selector: 'app-calendar',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './calendar.html',
  styleUrl: './calendar.css',
})
export class CalendarPage {
  readonly context = inject(OfficeContext);
  readonly badge = inject(TodoBadgeService);

  readonly today = todayLocal();
  readonly thisMonth = toYearMonth(this.today);
  readonly monthly = monthlyTasks();

  private readonly office = computed(() => {
    const o = this.context.current();
    if (!o) return null;
    return {
      bonusMonths: o.bonusMonths ?? [],
      insurer: o.healthInsurer?.type === 'kumiai' ? ('kumiai' as const) : ('kyokai' as const),
      deduction: payrollOf(o).deduction,
    };
  });

  /** 今月から12か月（月ごとの業務と、その月に納める前月分の期限） */
  readonly months = computed(() => {
    const o = this.office();
    if (!o) return [];
    const byMonth = yearTasks(o);
    return upcomingMonths(this.thisMonth).map((ym) => ({
      ym,
      y: Number(ym.slice(0, 4)),
      m: Number(ym.slice(5)),
      current: ym === this.thisMonth,
      due: dueDateOf(shiftMonth(ym, -1)),
      tasks: byMonth[Number(ym.slice(5)) - 1].tasks,
    }));
  });

  /** その月の業務の画面へ（アプリの外の業務は null） */
  linkOf(task: YearTask, ym: string): { path: unknown[]; query?: Record<string, string> } | null {
    const id = this.context.current()?.id;
    if (!id || !task.link) return null;
    const map: Record<Exclude<TaskLink, null>, { path: unknown[]; query?: Record<string, string> }> = {
      rates: { path: ['/o', id, 'settings'] },
      payrolls: { path: ['/o', id, 'payrolls'] },
      premiums: { path: ['/o', id, 'premiums'], query: { month: shiftMonth(ym, -1) } },
      revisions: { path: ['/o', id, 'revisions'] },
      regular: { path: ['/o', id, 'regular', this.regularYear(ym)] },
      bonuses: { path: ['/o', id, 'bonuses'] },
      filings: { path: ['/o', id, 'filings'] },
      employees: { path: ['/o', id, 'employees'] },
      home: { path: ['/o', id] },
    };
    return map[task.link];
  }

  private regularYear(ym: string): number {
    const o = this.context.current();
    return o && ym === this.thisMonth ? regularYearOf(latestPaidMonth(this.today, payrollOf(o))) : Number(ym.slice(0, 4));
  }
}
