// To-do リストの「まとまり」：種類ごとに分けて、急ぐ順に並べる
// Angular・Firebase に依存しない純粋な関数。確認済み（todoDismissals）を外すのもここ
//
// まとまりの並び（急ぐ順）
//   now（今すぐ）       ：資格取得届・加入の見直し・協定の確認・確認待ちの依頼
//   soon（期限が近い）  ：これから・区分変更届・証明書の期限・年齢到達
//   missing（材料不足） ：契約なし・事業所の設定

import { DateStr, YearMonth } from '../../../shared/utils/date';
import { AgeEvent, ageEventsIn, AgeTarget, compareAgeEvents, isActive } from '../../employees/logic/age-events';
import { ExtraKind, ExtraTodo } from './extra-todos';
import type { FilingTask, FilingTaskKind } from '../../../core/models/filing-task';
import { Todo, TodoKind } from './todos';

export type BoardKind = TodoKind | ExtraKind | FilingTaskKind | 'age' | 'requests' | 'office';
export type Section = 'now' | 'soon' | 'missing';
/** noStandard・noCriteria：判定の材料が足りない／newApplication：事業所整理記号が空（新規適用届はまだかも） */
export type OfficeIssue = 'noStandard' | 'noCriteria' | 'newApplication';

/** 1件（1人の1つの手続き。依頼と事業所の設定は人に結びつかない） */
export interface BoardItem {
  /** 確認済みの鍵（todoDismissals のドキュメントID） */
  key: string;
  kind: BoardKind;
  employeeId: string | null;
  /** 並べる日（手続きの日・誕生日） */
  date: DateStr | null;
  todo: Todo | null;
  age: AgeEvent | null;
  office: OfficeIssue | null;
  /** 在留・資格外活動・脱退一時金・特定適用事業所（extra-todos.ts） */
  extra?: ExtraTodo | null;
  /** 届出の宿題（変わった瞬間の出来事のメモ。filingTasks） */
  task?: FilingTask | null;
}

export interface BoardGroup {
  kind: BoardKind;
  section: Section;
  items: BoardItem[];
  /** 確認済みにしたもの（「確認済みを表示」で出す） */
  dismissed: BoardItem[];
}

/** まとまりの並び（この順に出す） */
export const BOARD_ORDER: readonly BoardKind[] = [
  'acquire',
  'lose',
  'agreement',
  'workPermit',
  'myNumberCheck',
  'requests',
  'officeNameAddress',
  'officeRelation',
  'address',
  'name',
  'dependentChange',
  'upcoming',
  'categoryChange',
  'certificateEnd',
  'overseasPayAbroad',
  'contractEnd',
  'overseasCertificate',
  'cardReturn',
  'retireGuide',
  'residence',
  'age',
  'lumpSum',
  'specificOffice',
  'myNumberDispose',
  'addressKumiai',
  'noContract',
  'office',
];

export const SECTION_OF: Record<BoardKind, Section> = {
  acquire: 'now',
  lose: 'now',
  agreement: 'now',
  workPermit: 'now',
  myNumberCheck: 'now',
  requests: 'now',
  officeNameAddress: 'now',
  officeRelation: 'now',
  address: 'now',
  name: 'now',
  dependentChange: 'now',
  overseasPayAbroad: 'now',
  overseasCertificate: 'soon',
  addressKumiai: 'soon',
  upcoming: 'soon',
  categoryChange: 'soon',
  certificateEnd: 'soon',
  contractEnd: 'soon',
  cardReturn: 'soon',
  retireGuide: 'soon',
  age: 'soon',
  residence: 'soon',
  lumpSum: 'soon',
  specificOffice: 'soon',
  myNumberDispose: 'soon',
  noContract: 'missing',
  office: 'missing',
};

/** 「確認した」で消せる種類（手続きをしないと直らないもの＝取得・喪失・協定・契約なしは消せない） */
export const DISMISSABLE: ReadonlySet<BoardKind> = new Set<BoardKind>([
  'upcoming',
  'categoryChange',
  'certificateEnd',
  'age',
  'residence', // 更新の許可を確かめたら消す（新しい満了日を入れれば、そもそも出なくなる）
  'workPermit', // 長期休業期間（1日8時間まで）など、確かめたうえで続ける場合
  'lumpSum', // 本人に案内したら消す
  'specificOffice', // 事業所の設定を確かめたら消す
  'retireGuide', // 本人に案内したら消す
  'cardReturn', // 回収した（または回収不能届を書いた）ら消す
  'contractEnd', // 同じ条件のまま自動で更新する場合など。次の契約か退職日を入れれば、そもそも出なくなる
  'overseasCertificate', // 延長の承認が出た（新しい期限を入れれば、そもそも出なくなる）など
  'overseasPayAbroad', // 日本の会社が負担する給与（留守宅手当など）があって、被保険者のままでよいと確かめた場合
  'myNumberDispose', // 「完結の日」を通知の日と考えて待つ場合など。廃棄すれば、そもそも出なくなる
]);

/** 1つのまとまりで最初に出す件数 */
export const GROUP_LIMIT = 5;

// ===== 鍵 =====

/** 日付を鍵に入れる → 同じ人に新しい変わり目が出れば、また出てくる */
export function todoKey(t: Pick<Todo, 'kind' | 'employeeId' | 'date'>): string {
  return `${t.kind}:${t.employeeId}:${t.date ?? '-'}`;
}

export function ageKey(employeeId: string, ev: Pick<AgeEvent, 'age'>): string {
  return `age:${employeeId}:${ev.age}`;
}

// ===== 1件を作る =====

export function todoItem(t: Todo): BoardItem {
  return { key: todoKey(t), kind: t.kind, employeeId: t.employeeId, date: t.date, todo: t, age: null, office: null };
}

/** 年齢到達（from〜to の月。在籍中の人だけ） */
export function ageItems(
  employees: readonly (AgeTarget & { id: string })[],
  from: YearMonth,
  to: YearMonth,
  today: DateStr,
): BoardItem[] {
  return employees
    .filter((e) => isActive(e, today))
    .flatMap((e) => ageEventsIn(e, from, to).map((ev) => ({ e, ev })))
    .sort((a, b) => compareAgeEvents(a.ev, b.ev, 'effect'))
    .map(({ e, ev }) => ({
      key: ageKey(e.id, ev),
      kind: 'age' as const,
      employeeId: e.id,
      date: ev.birthday,
      todo: null,
      age: ev,
      office: null,
    }));
}

/** 追加分の1件（鍵は種類・人・日付。日付が変われば、また出る） */
export function extraItem(t: ExtraTodo): BoardItem {
  return {
    key: `${t.kind}:${t.employeeId ?? '-'}:${t.date ?? '-'}`,
    kind: t.kind,
    employeeId: t.employeeId,
    date: t.date,
    todo: null,
    age: null,
    office: null,
    extra: t,
  };
}

/** 届出の宿題の1件（鍵は文書のID。「届を出した」で done にすると、次に読んだときから出ない） */
export function taskItem(t: FilingTask): BoardItem {
  return {
    key: `task:${t.id}`,
    kind: t.kind,
    employeeId: t.employeeId,
    date: t.factDate,
    todo: null,
    age: null,
    office: null,
    task: t,
  };
}

export function officeItem(issue: OfficeIssue): BoardItem {
  return { key: `office:${issue}`, kind: 'office', employeeId: null, date: null, todo: null, age: null, office: issue };
}

export function requestsItem(): BoardItem {
  return { key: 'requests', kind: 'requests', employeeId: null, date: null, todo: null, age: null, office: null };
}

// ===== 確認済み =====

/** 今日も効いている確認済みの鍵（until が null ならずっと、日付ならその日まで） */
export function activeDismissals(
  docs: readonly { key: string; until: DateStr | null }[],
  today: DateStr,
): Set<string> {
  return new Set(docs.filter((d) => d.until === null || d.until >= today).map((d) => d.key));
}

// ===== まとめる =====

/** 種類ごとにまとめて、決まった順に並べる（空のまとまりは出さない） */
export function groupBoard(items: readonly BoardItem[], dismissed: ReadonlySet<string>): BoardGroup[] {
  const map = new Map<BoardKind, BoardGroup>();
  for (const it of items) {
    let g = map.get(it.kind);
    if (!g) {
      g = { kind: it.kind, section: SECTION_OF[it.kind], items: [], dismissed: [] };
      map.set(it.kind, g);
    }
    const off = DISMISSABLE.has(it.kind) && dismissed.has(it.key);
    (off ? g.dismissed : g.items).push(it);
  }
  return BOARD_ORDER.map((k) => map.get(k)).filter((g): g is BoardGroup => !!g);
}

/** まとまりで出す分（開いていなければ GROUP_LIMIT 件まで）と、隠れている件数 */
export function visibleOf(g: BoardGroup, expanded: boolean): { shown: BoardItem[]; rest: number } {
  if (expanded || g.items.length <= GROUP_LIMIT) return { shown: g.items, rest: 0 };
  return { shown: g.items.slice(0, GROUP_LIMIT), rest: g.items.length - GROUP_LIMIT };
}

/** 確認済みを外したあとに残っている件数（見出しの「○件」） */
export function openCount(groups: readonly BoardGroup[]): number {
  return groups.reduce((s, g) => s + g.items.length, 0);
}
