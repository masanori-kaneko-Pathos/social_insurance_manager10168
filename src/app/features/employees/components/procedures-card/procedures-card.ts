import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Employee } from '../../../../core/models/employee';
import type { FilingTask } from '../../../../core/models/filing-task';
import { ToastService } from '../../../../shared/services/toast.service';
import { todayLocal } from '../../../../shared/utils/date';
import { FilingTaskService } from '../../../filings/filing-task.service';
import { OfficeContext } from '../../../office/office-context.service';
import { procedureRows, ProcedureRow } from '../../logic/procedures';

/**
 * 従業員の「手続き」（11/28）：手続き・発生日・提出状態（未完了／完了（日付））
 * 届出の記録と届出の宿題から、この人の分を並べる（procedures.ts）。読み書きは管理者だけ（届出の宿題が管理者だけのため）
 * 未完了の行は、提出した日を入れて完了にできる（届出の宿題は押した日が完了の日）
 */
@Component({
  selector: 'app-procedures-card',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './procedures-card.html',
  styleUrl: './procedures-card.css',
})
export class ProceduresCard {
  readonly employee = input.required<Employee>();

  private readonly api = inject(FilingTaskService);
  private readonly toast = inject(ToastService);
  readonly context = inject(OfficeContext);

  readonly rows = signal<ProcedureRow[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly busy = signal(false);
  /** 完了にする行（日付を入れている行） */
  readonly editing = signal<string | null>(null);
  readonly date = signal(todayLocal());

  constructor() {
    effect(() => {
      const id = this.employee().id;
      const officeId = this.context.current()?.id;
      if (officeId) void this.load(officeId, id);
    });
  }

  private async load(officeId: string, employeeId: string): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      const [filings, tasks] = await Promise.all([this.api.filingsOf(officeId, employeeId), this.api.listOf(officeId, employeeId)]);
      this.rows.set(procedureRows(filings, tasks, employeeId, doneDay));
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  startDone(r: ProcedureRow): void {
    this.date.set(todayLocal());
    this.editing.set(r.key);
  }

  async markDone(r: ProcedureRow): Promise<void> {
    const officeId = this.context.current()?.id;
    const day = this.date();
    if (!officeId || this.busy()) return;
    if (r.source === 'filing' && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    this.busy.set(true);
    try {
      if (r.source === 'filing') await this.api.markFilingSubmitted(officeId, r.id, day);
      else await this.api.markDone(officeId, r.id);
      this.editing.set(null);
      await this.load(officeId, this.employee().id);
    } catch {
      this.toast.show('employee.procedures.saveFailed');
    } finally {
      this.busy.set(false);
    }
  }
}

/** 届出の宿題の完了の日（「届を出した」を押した日。日本の日付） */
function doneDay(t: FilingTask): string | null {
  const d = t.doneAt?.toDate?.();
  return d ? todayLocal(d) : null;
}
