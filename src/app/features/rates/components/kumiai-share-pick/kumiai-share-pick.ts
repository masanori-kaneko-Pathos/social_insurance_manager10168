import { Component, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { KumiaiRateInput } from '../../../../core/models/rates';
import { ShareTarget } from '../../logic/kumiai-share';
import { RateService } from '../../rate.service';

/**
 * 同じ組合の料率がほかの事業所にあるとき、その料率を写すボタン（11/26）
 * 押したときだけ、その事業所の料率を読む。並べて確かめるのは親（app-rate-file-import の確認の表）
 */
@Component({
  selector: 'app-kumiai-share-pick',
  imports: [TranslocoPipe],
  template: `
    @if (targets().length) {
      <div class="share">
        <span class="lead">{{ 'rateImport.share.lead' | transloco }}</span>
        @for (t of targets(); track t.officeId) {
          <button
            type="button"
            class="btn btn-small"
            [disabled]="busy() || reading() !== null"
            (click)="pick(t)"
          >
            {{
              (reading() === t.officeId ? 'rateImport.share.reading' : 'rateImport.share.copy')
                | transloco: { name: t.officeName }
            }}
          </button>
        }
      </div>
      @if (error()) {
        <p class="field-error" role="alert">{{ 'rateImport.share.readError' | transloco }}</p>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .share {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-xs) var(--space-sm);
      margin: 0 0 var(--space-sm);
      font-size: var(--font-sm);
    }
    .lead {
      color: var(--color-text-sub);
    }
  `,
})
export class KumiaiSharePick {
  private readonly rates = inject(RateService);

  /** 同じ組合に入っている（入っていた）ほかの事業所 */
  readonly targets = input<readonly ShareTarget[]>([]);
  readonly busy = input(false);
  /** 読めた料率（label は確認の表のファイル名の場所に出す名前） */
  readonly picked = output<{ rates: KumiaiRateInput[]; label: string }>();

  readonly reading = signal<string | null>(null);
  readonly error = signal(false);

  async pick(t: ShareTarget): Promise<void> {
    this.reading.set(t.officeId);
    this.error.set(false);
    try {
      const list = await this.rates.kumiaiList(t.officeId);
      const rates = list.map(({ from, health, care, childSupport }) => ({
        from,
        health,
        care,
        childSupport,
      }));
      this.picked.emit({ rates, label: t.officeName });
    } catch (err) {
      console.error(err);
      this.error.set(true);
    } finally {
      this.reading.set(null);
    }
  }
}
