import { Component, effect, inject, signal } from '@angular/core';
import { Dependent } from '../../../../core/models/dependent';
import { DependentService } from '../../../employees/dependent.service';
import { MeContext } from '../../../me/me-context.service';
import { MyNumberService } from '../../my-number.service';
import { MyNumberSubmit } from '../my-number-submit/my-number-submit';

/**
 * マイページ：家族のマイナンバーの提出（会社から家族の分の依頼が来ているときだけ出る。11/12）
 * 家族の状態の文書を1回読み、依頼・差し戻し・チェック待ちの家族がいるときだけ扶養家族を読む
 */
@Component({
  selector: 'app-family-my-number-submit',
  imports: [MyNumberSubmit],
  template: `
    @for (d of shown(); track d.id) {
      <app-my-number-submit [dependent]="d" />
    }
  `,
})
export class FamilyMyNumberSubmit {
  private readonly me = inject(MeContext);
  private readonly api = inject(MyNumberService);
  private readonly dependentsApi = inject(DependentService);

  readonly shown = signal<Dependent[]>([]);

  constructor() {
    effect(() => {
      const ref = this.me.ref();
      if (this.me.employee() && ref) void this.load(ref.officeId, ref.employeeId);
    });
  }

  private async load(officeId: string, employeeId: string): Promise<void> {
    try {
      const entries = await this.api.familyEntries(officeId, employeeId);
      const ids = [...entries].filter(([, e]) => e.status !== 'registered' && e.status !== 'refused').map(([id]) => id);
      if (ids.length === 0) {
        this.shown.set([]);
        return;
      }
      const list = await this.dependentsApi.list(officeId, employeeId);
      this.shown.set(list.filter((d) => ids.includes(d.id)));
    } catch (err) {
      console.error(err);
    }
  }
}
