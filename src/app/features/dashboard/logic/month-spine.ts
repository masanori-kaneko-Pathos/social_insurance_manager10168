// ホームの「今月の処理」（11/26）：手続き → 保険料の確認 → 給与 → 改定 の段ごとに、実際の人数と状態を出す
// 順番は仕事の順：今月払いの給与から控除する保険料は、給与ソフトで給与を計算する前に決める。
// このアプリの「給与の入力」は払ったあとの明細の記録で、改定の候補はその記録から出る
// 段の数字は、それぞれの画面と同じ数え方の結果を受け取るだけ（ここでは数えない）
// Angular・Firebase に依存しない純粋な関数

import type { GuideStep } from '../../../shared/components/step-guide/step-guide';

export interface MonthSpineInput {
  /** To-do（今すぐ・期限が近い）の件数。給与の未入力は除く。読み込み中は null */
  todo: number | null;
  /** 今月払いの給与の未入力の人数。読み込み中は null */
  payrollMissing: number | null;
  /** 改定の候補（3か月そろった人・月を待っている人）。読み込み中は null、読めなかったら 'error' */
  revision: { candidates: number; waiting: number } | null | 'error';
  /** 今月払いの給与から控除する月の保険料の確認。読み込み中は null */
  premium: {
    /** 本人負担を確認済みにしたか */
    closed: boolean;
    /** 告知額を保存したか */
    noticeSaved: boolean;
    /** 告知額を別の人が確認したか */
    reviewed: boolean;
    /** 確認できる別のメンバーがいない */
    solo: boolean;
  } | null;
  /** 画面に出す月（保険料の月・給与の支払月の「月」の数字） */
  premiumMonth: number;
  payMonth: number;
}

const step = (
  key: string,
  state: GuideStep['state'],
  noteKey: string,
  noteParams?: Record<string, unknown>,
): GuideStep => ({
  key,
  labelKey: `home.spine.step.${key}`,
  state,
  noteKey: `home.spine.note.${noteKey}`,
  noteParams,
});

/** 読み込み中の段（状態は「まだ」、注記は「確認中…」） */
const loading = (key: string) => step(key, 'todo', 'loading');

export function monthSpine(x: MonthSpineInput): GuideStep[] {
  const todo =
    x.todo === null
      ? loading('todo')
      : x.todo > 0
        ? step('todo', 'attention', 'todoCount', { count: x.todo })
        : step('todo', 'done', 'todoNone');

  const payroll =
    x.payrollMissing === null
      ? loading('payroll')
      : x.payrollMissing > 0
        ? step('payroll', 'todo', 'payrollMissing', { count: x.payrollMissing, m: x.payMonth })
        : step('payroll', 'done', 'payrollDone', { m: x.payMonth });

  const r = x.revision;
  const revision =
    r === null
      ? loading('revision')
      : r === 'error'
        ? step('revision', 'todo', 'revisionError')
        : r.candidates > 0
          ? step('revision', 'attention', 'revisionCandidates', { count: r.candidates })
          : r.waiting > 0
            ? step('revision', 'done', 'revisionWaiting', { count: r.waiting })
            : step('revision', 'done', 'revisionNone');

  const p = x.premium;
  const m = x.premiumMonth;
  const premium =
    p === null
      ? loading('premium')
      : !p.closed
        ? step('premium', 'todo', 'premiumOpen', { m })
        : !p.noticeSaved
          ? step('premium', 'todo', 'premiumNotice', { m })
          : !p.reviewed && !p.solo
            ? step('premium', 'todo', 'premiumReview', { m })
            : step('premium', 'done', 'premiumDone', { m });

  return inOrder([todo, premium, payroll, revision]);
}

/**
 * 順番どおりに「済み」にする（11/27）：前の段が済んでいないうちは、あとの段は済みにしない
 * - あとの段の「済み」は「まだ」にして、注記は「（止まっている段）の完了待ち」にする
 *   例：保険料の確認がまだなのに、給与が全員入力済みでも、給与の段は「保険料の確認の完了待ち」
 * - 要確認・まだ・確認中の段は、そのまま（人数などの注記は残す）
 */
function inOrder(steps: GuideStep[]): GuideStep[] {
  let blocker: string | null = null;
  return steps.map((s) => {
    const out = blocker !== null && s.state === 'done' ? step(s.key, 'todo', `waitFor.${blocker}`) : s;
    if (blocker === null && s.state !== 'done') blocker = s.key;
    return out;
  });
}
