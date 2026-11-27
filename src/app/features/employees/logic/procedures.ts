import type { FilingTask } from '../../../core/models/filing-task';
import type { Filing } from '../../../core/models/office-records';

/**
 * 従業員の「手続き」の一覧（11/28）
 * 届出の記録（offices/{o}/filings）と届出の宿題（filingTasks）から、その人の分を「手続き・発生日・提出状態」で並べる
 * - 提出状態は2つ：未完了／完了（提出した日つき）
 * - 届出の記録：提出した日があれば完了、作っただけ（提出した日が空）なら未完了
 * - 届出の宿題：done なら完了（「届を出した」を押した日）、open なら未完了
 * To-do で計算して出している届（まだ記録のないもの）は、ここには出ない（To-do の画面で見る）
 */
export interface ProcedureRow {
  /** 'filing:{id}' / 'task:{id}' */
  key: string;
  source: 'filing' | 'task';
  id: string;
  /** 文言の鍵 */
  label: string;
  /** 発生日（'YYYY-MM-DD' か 'YYYY-MM'。分からなければ null） */
  date: string | null;
  done: boolean;
  /** 完了した日（完了のときだけ） */
  doneOn: string | null;
}

const DATE_LIKE = /^\d{4}-\d{2}(-\d{2})?$/;

export function procedureRows(filings: readonly Filing[], tasks: readonly FilingTask[], employeeId: string, doneDay: (t: FilingTask) => string | null): ProcedureRow[] {
  const rows: ProcedureRow[] = [
    ...filings
      .filter((f) => f.employeeIds.includes(employeeId))
      .map((f): ProcedureRow => ({
        key: `filing:${f.id}`,
        source: 'filing',
        id: f.id,
        label: `employee.procedures.type.${f.type}`,
        date: f.subject && DATE_LIKE.test(f.subject) ? f.subject : null,
        done: !!f.submittedOn,
        doneOn: f.submittedOn ?? null,
      })),
    ...tasks
      .filter((t) => t.employeeId === employeeId)
      .map((t): ProcedureRow => ({
        key: `task:${t.id}`,
        source: 'task',
        id: t.id,
        label: `dashboard.todo.kind.${t.kind}`,
        date: t.factDate,
        done: t.status === 'done',
        doneOn: t.status === 'done' ? doneDay(t) : null,
      })),
  ];
  // 未完了を先に、そのあと発生日の新しい順
  return rows.sort((a, b) => Number(a.done) - Number(b.done) || (b.date ?? '').localeCompare(a.date ?? ''));
}
