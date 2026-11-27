import { Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { currentStepKey } from './step-current';

/** 段階の状態：済み／要確認／まだ／していない（飛ばした） */
export type StepState = 'done' | 'attention' | 'todo' | 'skipped';

export interface GuideStep {
  key: string;
  /** 段階の名前（翻訳のキー） */
  labelKey: string;
  state: StepState;
  /** 状態の横に出す短い文（翻訳のキー。省略なら状態の名前） */
  noteKey?: string | null;
  noteParams?: Record<string, unknown>;
}

/**
 * 業務の段階の案内（11/26。保険料のページの「①本人負担 → ②給与ソフトと照合 → ③納付額 → ④告知額」）
 * - 段階ごとに、済み・要確認・まだ を出す。押すとその段へ動く（親が go を受けて動かす）
 * - 順番どおりにしか押せない、にはしない（どこからでも見られる。順番は案内だけ）
 */
@Component({
  selector: 'app-step-guide',
  imports: [TranslocoPipe],
  templateUrl: './step-guide.html',
  styleUrl: './step-guide.css',
})
export class StepGuide {
  readonly steps = input.required<readonly GuideStep[]>();
  /** 案内の名前（読み上げ用。翻訳のキー） */
  readonly labelKey = input('stepGuide.label');
  readonly go = output<string>();
  /** 次にやる段（印を付ける。11/27） */
  readonly current = computed(() => currentStepKey(this.steps()));
}
