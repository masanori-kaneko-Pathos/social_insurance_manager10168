import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Employee } from '../../../../core/models/employee';
import { ToastService } from '../../../../shared/services/toast.service';
import { OfficeContext } from '../../../office/office-context.service';
import { EmployeeService } from '../../employee.service';

/**
 * 登録の取り消し（11/17）：間違えて登録した人（二重登録など）を消す。管理者だけ
 * 退職は退職日で表すので、ここは使わない。社員番号（番号がない人は姓）を打ち込んでから消す
 * 届出の記録・マイナンバー・マイページがある人は、関数が断る（理由を出す）
 */
@Component({
  selector: 'app-employee-delete-card',
  imports: [TranslocoPipe],
  templateUrl: './employee-delete-card.html',
  styleUrl: './employee-delete-card.css',
})
export class EmployeeDeleteCard {
  readonly employee = input.required<Employee>();

  private readonly api = inject(EmployeeService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly context = inject(OfficeContext);

  readonly open = signal(false);
  readonly typed = signal('');
  readonly deleting = signal(false);
  readonly errorKey = signal<string | null>(null);

  /** 確認に打ち込む文字：社員番号（なければ姓） */
  readonly expected = computed(() => this.employee().employeeNumber || this.employee().lastName);
  readonly typedOk = computed(() => this.typed().trim() === this.expected().trim());

  cancel(): void {
    this.open.set(false);
    this.typed.set('');
    this.errorKey.set(null);
  }

  async remove(): Promise<void> {
    const office = this.context.current();
    if (!office || !this.typedOk() || this.deleting()) return;
    this.deleting.set(true);
    this.errorKey.set(null);
    try {
      await this.api.deleteEmployee(office.id, this.employee().id, this.typed().trim());
      this.toast.show('employee.delete.done');
      await this.router.navigate(['/o', office.id, 'employees']);
    } catch (err) {
      console.error(err);
      const r = (err as { details?: { reason?: string } })?.details?.reason;
      this.errorKey.set(`employee.delete.error.${r ?? 'unknown'}`);
    } finally {
      this.deleting.set(false);
    }
  }
}
