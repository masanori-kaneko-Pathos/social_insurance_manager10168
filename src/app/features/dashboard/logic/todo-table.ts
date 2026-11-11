// ホームの To-do を「1行1件の表」にする：届出の期限・急ぎのバッジ・並べ方・絞り込み
// Angular・Firebase に依存しない純粋な関数。To-do を作る仕組み（todos.ts・todo-board.ts）はそのまま使う
//
// 届出の期限（日本年金機構の各届のページ。11/11 に本人が確認）
// - 資格取得届・資格喪失届・被保険者区分変更届：事実発生から5日以内（当日から起算 → 当日 ＋ 4日）
// - 70歳到達届：到達日から5日以内。ただし報酬が変わる人だけ（同じなら機構が処理し、届は不要）
// - 75歳（健康保険の喪失）：喪失日（75歳の誕生日）から5日以内
// - 40・65歳：届出なし

import { addDays, DateStr, daysInclusive } from '../../../shared/utils/date';
import { BoardGroup, BoardItem, BoardKind } from './todo-board';

/** 当日から起算して5日以内 → 当日を1日目として、5日目が期限 */
export const FILING_DAYS = 5;
/** 期限まで何日以内なら「今すぐ」にするか */
export const NOW_DAYS = 3;
/** 最初に出す行の数 */
export const TABLE_LIMIT = 10;

export type Urgency = 'overdue' | 'now' | 'soon' | 'missing' | 'info';
/** 期限に添える言葉：報酬が変わるときだけ届が要る／日が分からないので速やかに */
export type DeadlineNote = 'onlyIfPayChanges' | 'asap' | null;

export interface TodoRow {
  item: BoardItem;
  dismissed: boolean;
  deadline: DateStr | null;
  note: DeadlineNote;
  urgency: Urgency;
}

/** 事実の日 → 届の期限（当日を含めて5日） */
export function filingDeadline(factDate: DateStr): DateStr {
  return addDays(factDate, FILING_DAYS - 1);
}

/** 1件の届出の期限 */
export function deadlineOf(it: BoardItem): { deadline: DateStr | null; note: DeadlineNote } {
  switch (it.kind) {
    case 'acquire':
    case 'agreement':
    case 'certificateEnd':
    case 'upcoming':
    case 'categoryChange':
      return it.date ? { deadline: filingDeadline(it.date), note: null } : { deadline: null, note: 'asap' };
    case 'lose':
      return { deadline: null, note: 'asap' };
    case 'age': {
      const ev = it.age;
      if (ev?.age === 70) return { deadline: filingDeadline(ev.reachDate), note: 'onlyIfPayChanges' };
      if (ev?.age === 75) return { deadline: filingDeadline(ev.birthday), note: null };
      return { deadline: null, note: null };
    }
    default:
      return { deadline: null, note: null };
  }
}

/** 急ぎのバッジ：期限があれば期限から、なければ種類から */
export function urgencyOf(kind: BoardKind, deadline: DateStr | null, note: DeadlineNote, today: DateStr): Urgency {
  if (deadline) {
    if (deadline < today) return 'overdue';
    return daysInclusive(today, deadline) - 1 <= NOW_DAYS ? 'now' : 'soon';
  }
  if (note === 'asap' || kind === 'requests') return 'now';
  if (kind === 'noContract' || kind === 'office') return 'missing';
  return 'info';
}

const RANK: Record<Urgency, number> = { overdue: 0, now: 1, soon: 2, missing: 3, info: 4 };

/** 急ぐ順：バッジ → 期限の近い順（期限なしは後ろ）→ 日付 → 人 */
export function compareRows(a: TodoRow, b: TodoRow): number {
  return (
    RANK[a.urgency] - RANK[b.urgency] ||
    (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') ||
    (a.item.date ?? '9999').localeCompare(b.item.date ?? '9999') ||
    a.item.key.localeCompare(b.item.key)
  );
}

/** 種類ごとのまとまり → 1つの表（確認済みも入れて、印をつける） */
export function toRows(groups: readonly BoardGroup[], today: DateStr): TodoRow[] {
  const row = (item: BoardItem, dismissed: boolean): TodoRow => {
    const { deadline, note } = deadlineOf(item);
    return { item, dismissed, deadline, note, urgency: urgencyOf(item.kind, deadline, note, today) };
  };
  return groups
    .flatMap((g) => [...g.items.map((i) => row(i, false)), ...g.dismissed.map((i) => row(i, true))])
    .sort(compareRows);
}

export type RowView = 'open' | 'dismissed';

/** 絞り込み：未対応／確認済み、と種類 */
export function filterRows(rows: readonly TodoRow[], view: RowView, kind: BoardKind | 'all'): TodoRow[] {
  return rows.filter((r) => r.dismissed === (view === 'dismissed') && (kind === 'all' || r.item.kind === kind));
}

/** 表にある種類（プルダウンの選択肢。並びは決まった順） */
export function kindsIn(rows: readonly TodoRow[], order: readonly BoardKind[]): BoardKind[] {
  const has = new Set(rows.map((r) => r.item.kind));
  return order.filter((k) => has.has(k));
}

/** 期限まであと何日か（今日 ＝ 0。過ぎていればマイナス） */
export function daysLeft(deadline: DateStr, today: DateStr): number {
  return deadline >= today ? daysInclusive(today, deadline) - 1 : -(daysInclusive(deadline, today) - 1);
}
