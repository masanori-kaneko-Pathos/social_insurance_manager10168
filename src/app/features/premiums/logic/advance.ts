// 保険料の立替：給与から本人負担を控除しきれない月を見つける
// Angular・Firebase に依存しない純粋な関数
//
// 休職・休業（免除にならないもの）・欠勤が多い月などは、給与（通貨）が本人負担の社会保険料より少なく、
// 給与から引ききれない。その分は会社が立て替えて年金事務所に納め、あとで本人から回収する（振込・復職後の給与から など）
// アプリはお金の動きを持たないので「立替が要りそうな月」に印を付けるだけ。回収の記録は持たない

import type { Payroll } from '../../../core/models/payroll';

export type AdvanceState =
  | 'none' // 控除できる
  | 'needed' // 給与（通貨）が本人負担より少ない
  | 'unknown'; // その支払月の給与の実績がない（判断できない）

/** 保険料を控除する支払月の給与と、本人負担（円）から */
export function advanceState(payroll: Pick<Payroll, 'cash'> | null, employeeYen: number): AdvanceState {
  if (employeeYen <= 0) return 'none';
  if (!payroll) return 'unknown';
  return payroll.cash < employeeYen ? 'needed' : 'none';
}

/** 立て替える額の目安（本人負担 − 給与。マイナスは 0） */
export function advanceAmount(payroll: Pick<Payroll, 'cash'>, employeeYen: number): number {
  return Math.max(0, employeeYen - payroll.cash);
}
