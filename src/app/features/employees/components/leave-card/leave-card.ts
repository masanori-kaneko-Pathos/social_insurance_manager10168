import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { emptyLeave, Employee, Leave, LeaveKind } from '../../../../core/models/employee';
import { OfficeContext } from '../../../office/office-context.service';
import { EmployeeService } from '../../employee.service';
import { exemptRangeOf, LeaveLike } from '../../logic/leave';

import { HalfWidthDigits } from '../../../../shared/directives/half-width-digits';
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const NEW = 'new';
/** ルールの上限と同じ */
const MAX_LEAVES = 20;

interface Row {
  leave: LeaveLike;
  index: number; // 保存されている配列の中の位置（編集・削除に使う）
  range: { from: string; to: string | null } | null;
}

/** 従業員の詳細に出す「産休・育休」（追加・編集・削除は管理者だけ） */
@Component({
  selector: 'app-leave-card',
  imports: [HalfWidthDigits, ReactiveFormsModule, TranslocoPipe],
  templateUrl: './leave-card.html',
  styleUrl: './leave-card.css',
})
export class LeaveCard {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(EmployeeService);
  readonly context = inject(OfficeContext);

  readonly employee = input.required<Employee>();
  /** 保存・削除したことを知らせる（詳細画面が従業員を読み直し、保険料も計算し直す） */
  readonly changed = output<void>();

  readonly kinds: LeaveKind[] = ['maternity', 'childcare'];

  /** 新しい順 */
  readonly rows = computed<Row[]>(() =>
    (this.employee().leaves ?? [])
      .map((leave, index) => ({ leave, index, range: exemptRangeOf(leave) }))
      .sort((a, b) => b.leave.start.localeCompare(a.leave.start)),
  );

  /** 'new' は追加、数字は編集中の位置、null は閉じている */
  readonly editing = signal<typeof NEW | number | null>(null);
  readonly confirmingDelete = signal<number | null>(null);
  readonly saving = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly formErrorKey = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    kind: ['childcare' as LeaveKind],
    start: [''],
    end: [''],
    undecided: [false],
  });

  constructor() {
    // 「未定」にしたら終了日は入れられない
    this.form.controls.undecided.valueChanges.subscribe((v) => {
      if (v) this.form.controls.end.disable();
      else this.form.controls.end.enable();
    });
  }

  startAdd(): void {
    this.form.reset({ kind: 'childcare', start: '', end: '', undecided: false });
    this.openEdit(NEW);
  }

  startEdit(row: Row): void {
    this.form.reset({
      kind: row.leave.kind,
      start: row.leave.start,
      end: row.leave.end ?? '',
      undecided: row.leave.end === null,
    });
    this.openEdit(row.index);
  }

  private openEdit(mode: typeof NEW | number): void {
    this.formErrorKey.set(null);
    this.errorKey.set(null);
    this.confirmingDelete.set(null);
    this.editing.set(mode);
  }

  cancel(): void {
    this.editing.set(null);
  }

  /** 入力の確認。問題があれば翻訳キーを返す */
  private check(l: LeaveLike, others: LeaveLike[]): string | null {
    if (!DATE.test(l.start)) return 'leave.error.start';
    if (l.end !== null && !DATE.test(l.end)) return 'leave.error.end';
    if (l.end !== null && l.end < l.start) return 'leave.error.order';
    const endOf = (x: LeaveLike) => x.end ?? '9999-12-31';
    if (others.some((o) => o.start <= endOf(l) && l.start <= endOf(o))) return 'leave.error.overlap';
    return null;
  }

  async save(): Promise<void> {
    const mode = this.editing();
    if (mode === null || this.saving()) return;
    const v = this.form.getRawValue();
    const current = this.employee().leaves ?? [];
    // 画面にまだ出していない項目（出産予定日・子の情報など）は、編集なら元の値を残す
    const base: Leave = mode === NEW ? emptyLeave(v.kind, v.start) : current[mode];
    const leave: Leave = {
      ...base,
      kind: v.kind,
      start: v.start,
      end: v.undecided ? null : v.end || '',
    };
    const others = current.filter((_, i) => i !== mode);
    if (mode === NEW && current.length >= MAX_LEAVES) {
      this.formErrorKey.set('leave.error.tooMany');
      return;
    }
    const error = this.check(leave, others);
    this.formErrorKey.set(error);
    if (error) return;

    await this.write([...others, leave]);
    if (!this.errorKey()) this.editing.set(null);
  }

  async remove(index: number): Promise<void> {
    const current = this.employee().leaves ?? [];
    await this.write(current.filter((_, i) => i !== index));
    if (!this.errorKey()) this.confirmingDelete.set(null);
  }

  private async write(leaves: Leave[]): Promise<void> {
    const officeId = this.context.current()?.id;
    if (!officeId) return;
    this.saving.set(true);
    this.errorKey.set(null);
    try {
      const sorted = [...leaves].sort((a, b) => a.start.localeCompare(b.start));
      await this.api.updateLeaves(officeId, this.employee().id, sorted);
      this.changed.emit();
    } catch (err) {
      console.error(err);
      this.errorKey.set('leave.error.save');
    } finally {
      this.saving.set(false);
    }
  }
}
