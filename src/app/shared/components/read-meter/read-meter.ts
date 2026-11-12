import { Component, computed, inject } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { readByCollection, readMeterOn, readTotal, resetReads } from '../../../core/read-meter';

/**
 * 読み込みの回数（開発・確認のときだけ。core/read-meter.ts）
 * 画面を移るたびに0から数え直す。右下に小さく出す
 */
@Component({
  selector: 'app-read-meter',
  template: `
    @if (on) {
      <aside class="read-meter" aria-live="polite">
        <strong>読み込み {{ total() }}</strong>
        <ul>
          @for (r of top(); track r[0]) {
            <li>{{ r[0] }}：{{ r[1] }}</li>
          }
        </ul>
        <button type="button" (click)="reset()">0に戻す</button>
      </aside>
    }
  `,
  styles: `
    .read-meter {
      position: fixed;
      right: 8px;
      bottom: 8px;
      z-index: 9999;
      padding: 6px 10px;
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.75);
      color: #fff;
      font-size: 12px;
      line-height: 1.5;
    }
    ul {
      margin: 0;
      padding-left: 1em;
    }
    button {
      margin-top: 4px;
      font-size: 11px;
    }
  `,
})
export class ReadMeter {
  readonly on = readMeterOn;
  readonly total = readTotal;
  /** 多い順に6つ */
  readonly top = computed(() => [...readByCollection().entries()].sort((a, b) => b[1] - a[1]).slice(0, 6));

  constructor() {
    if (!this.on) return;
    inject(Router).events.subscribe((e) => {
      if (e instanceof NavigationStart) resetReads();
    });
  }

  reset(): void {
    resetReads();
  }
}
