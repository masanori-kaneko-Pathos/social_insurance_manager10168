import { Component, computed, effect, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { MY_NUMBER_DOC_TYPES, MyNumberDocType, MyNumberEntry } from '../../../../core/models/my-number';
import { MeContext } from '../../../me/me-context.service';
import { myNumberProblem, normalizeMyNumber } from '../../logic/my-number';
import { myNumberReason, MyNumberService } from '../../my-number.service';

/**
 * マイページのマイナンバーの提出（会社から依頼が来ているとき・差し戻されたとき）
 * 入れた番号は関数へそのまま渡す（画面にも Firestore の依頼にも残さない）
 */
@Component({
  selector: 'app-my-number-submit',
  imports: [TranslocoPipe],
  templateUrl: './my-number-submit.html',
  styleUrl: '../my-number-card/my-number-card.css',
})
export class MyNumberSubmit {
  private readonly me = inject(MeContext);
  private readonly api = inject(MyNumberService);

  readonly docTypes = MY_NUMBER_DOC_TYPES;
  readonly entry = signal<MyNumberEntry | null>(null);
  readonly numberText = signal('');
  readonly docType = signal<MyNumberDocType>('card');
  readonly busy = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly done = signal(false);

  readonly status = computed(() => this.entry()?.status ?? null);
  readonly canSubmit = computed(() => this.status() === 'requested' || this.status() === 'returned');
  readonly numberProblem = computed(() => myNumberProblem(this.numberText()));

  constructor() {
    effect(() => {
      const ref = this.me.ref();
      if (this.me.employee() && ref) void this.load(ref.officeId, ref.employeeId);
    });
  }

  private async load(officeId: string, employeeId: string): Promise<void> {
    try {
      this.entry.set(await this.api.entry(officeId, employeeId));
    } catch (err) {
      console.error(err);
    }
  }

  async submit(): Promise<void> {
    const n = normalizeMyNumber(this.numberText());
    const ref = this.me.ref();
    if (!ref || !n || this.numberProblem() || this.busy()) return;
    this.busy.set(true);
    this.errorKey.set(null);
    try {
      await this.api.submit(n, this.docType());
      this.numberText.set('');
      this.done.set(true);
      await this.load(ref.officeId, ref.employeeId);
    } catch (err) {
      console.error(err);
      this.errorKey.set(`myNumber.reason.${myNumberReason(err)}`);
    } finally {
      this.busy.set(false);
    }
  }

  input(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }
}
