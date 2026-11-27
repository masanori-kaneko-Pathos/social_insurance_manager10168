// 業務の段階の案内で「いまの段階」を決める（11/27。Q12）
// Angular に依存しない純粋な関数

import type { StepState } from './step-guide';

/**
 * 次にやる段（済みでも、していない（飛ばした）でもない最初の段）。全部済みなら null
 * 画面は勝手に開いたり動いたりせず、案内のその段に印を付けるだけ（ページの位置が動かないように）
 */
export function currentStepKey(steps: readonly { key: string; state: StepState }[]): string | null {
  return steps.find((s) => s.state !== 'done' && s.state !== 'skipped')?.key ?? null;
}
