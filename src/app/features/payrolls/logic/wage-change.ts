// 固定的賃金の変動を、人が足す・外す（B11。11/17）
// 給与の実績から自動で見つからない変動（時給の改定・現物の変化など）を足し、
// 固定的賃金の変動ではないもの（入力の直し・端数の調整など）を外す。改定の候補は、これを入れて計算し直す
// Angular・Firebase に依存しない純粋な関数

import type { ChangeDirection, WageChange, WageChangeKind, WageChangeSource } from '../../../core/models/revision';
import { CHANGE_DIRECTIONS, WAGE_CHANGE_KINDS } from '../../../core/models/revision';

export interface WageChangeForm {
  employeeId: string;
  month: string; // 起算月（変動が1か月分そろって反映された支払月）
  kind: WageChangeKind | '';
  direction: ChangeDirection | '';
  note: string;
}

export type WageChangeError = 'employee' | 'month' | 'tooOld' | 'future' | 'kind' | 'direction' | 'note';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * 足すときの確かめ
 * - 起算月は、改定の候補を出し始める月（fromMonth）から今月まで（それより前は候補に出ないので足しても意味がない）
 */
export function wageChangeErrors(
  f: WageChangeForm,
  ctx: { fromMonth: string; thisMonth: string },
): Partial<Record<keyof WageChangeForm, WageChangeError>> {
  const e: Partial<Record<keyof WageChangeForm, WageChangeError>> = {};
  if (!f.employeeId) e.employeeId = 'employee';
  if (!MONTH.test(f.month)) e.month = 'month';
  else if (f.month < ctx.fromMonth) e.month = 'tooOld';
  else if (f.month > ctx.thisMonth) e.month = 'future';
  if (!WAGE_CHANGE_KINDS.includes(f.kind as WageChangeKind)) e.kind = 'kind';
  if (!CHANGE_DIRECTIONS.includes(f.direction as ChangeDirection)) e.direction = 'direction';
  if (f.note.trim().length > 200) e.note = 'note';
  return e;
}

/** 保存する形（メモの空は null） */
export function toWageChange(f: WageChangeForm, source: WageChangeSource): WageChange {
  return {
    month: f.month,
    source,
    kind: (f.kind || 'other') as WageChangeKind,
    direction: (f.direction || 'unclear') as ChangeDirection,
    note: f.note.trim() || null,
  };
}

/** 種類から、向きの初期値（昇給・手当の新設は上がる、降給・手当の廃止は下がる） */
export function directionOfKind(kind: WageChangeKind | ''): ChangeDirection | '' {
  if (kind === 'raise' || kind === 'allowanceNew') return 'up';
  if (kind === 'cut' || kind === 'allowanceEnd') return 'down';
  return '';
}
