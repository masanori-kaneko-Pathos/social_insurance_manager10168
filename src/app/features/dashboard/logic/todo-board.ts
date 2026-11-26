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
/**
 * noStandard・noCriteria：判定の材料が足りない／newApplication：事業所整理記号が空（新規適用届はまだかも）
 * noInsurerNumber：組合健保なのに保険者番号が空（11/26。同じ組合のほかの事業所を見分けられない）
 */
export type OfficeIssue = 'noStandard' | 'noCriteria' | 'newApplication' | 'noInsurerNumber';

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
  /** 同じ日の同じ届をまとめた行の中身（1人ずつの行。「確認した」は1人ずつの鍵で残す。11/20） */
  members?: BoardItem[] | null;
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
  'payrollMissing', // 今月払いの給与の未入力（毎月の作業。11/26）
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
  'adjustmentDeadline',
  'ratesMissing',
  'insurerChange',
  'actualHours',
  'acquireAmount',
  'bonusNone',
  'bonusReport',
  'acquireReport',
  'lossReport',
  'dependentReport',
  'bonusCumulative',
  'childcareSpecial',
  'birthDate',
  'myNumberDispose',
  'addressKumiai',
  'noContract',
  'officerCheck',
  'registerGaps',
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
  adjustmentDeadline: 'soon',
  ratesMissing: 'soon',
  payrollMissing: 'now',
  insurerChange: 'soon',
  actualHours: 'now',
  acquireAmount: 'now',
  bonusNone: 'now',
  bonusReport: 'now',
  acquireReport: 'now',
  lossReport: 'now',
  dependentReport: 'now',
  bonusCumulative: 'soon',
  childcareSpecial: 'soon',
  birthDate: 'now',
  myNumberDispose: 'soon',
  noContract: 'missing',
  officerCheck: 'missing',
  registerGaps: 'missing',
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
  'adjustmentDeadline', // 制度を使わないと決めたら消す（申し出て設定に入れれば、そもそも出なくなる）
  'ratesMissing', // 料率が変わらない組合など。料率を登録すれば、そもそも出なくなる
  'insurerChange', // 手続きを済ませた（案内を読んだ）ら消す
  'acquireAmount', // 取得後に決まった昇給など、入れ漏れではないと確かめたら消す
  'actualHours', // 一時的な残業で、続く見込みがないと確かめたら消す
  'bonusNone', // 不支給報告書を出したら消す（支払予定月にあとから賞与を入れれば、そもそも出なくなる）
  'bonusReport', // 賞与支払届を出したら消す
  'acquireReport', // 資格取得届を出したら消す
  'lossReport', // 資格喪失届を出したら消す
  'dependentReport', // 被扶養者（異動）届を出したら消す
  'bonusCumulative', // 本人に案内した（申出書を出した）ら消す
  'childcareSpecial', // 申出書を出した（本人が出さないと決めた）ら消す
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
  return BOARD_ORDER.map((k) => map.get(k))
    .filter((g): g is BoardGroup => !!g)
    .map((g) => (MERGEABLE.has(g.kind) ? { ...g, items: mergeSameDay(g.items) } : g));
}

// ===== 同じ日の届をまとめる（11/20） =====

/**
 * 同じ日に2人以上いれば1行にまとめる種類（春の一斉入社・3月末の一斉退職で、同じ届が人数分並ばないように）
 * 届は1人ずつ出すこともできるので、名簿で選んだ人だけ「確認した」にできる
 */
export const MERGEABLE: ReadonlySet<BoardKind> = new Set<BoardKind>(['acquireReport', 'lossReport', 'dependentReport']);

/** まとめた行の鍵（確認済みには使わない。開いた行・押している最中の目印だけ） */
export function mergedKey(kind: BoardKind, date: DateStr): string {
  return `merged:${kind}:${date}`;
}

/**
 * 未対応の行を、同じ日ごとに1行にまとめる（1人だけの日はそのまま）
 * - まとめた行は、その日の最初の人の位置に置く（並びは表の側で期限の順に並べ直す）
 * - 確認済みの行はまとめない（確認済みの一覧では1人ずつ戻せるように）
 */
export function mergeSameDay(items: readonly BoardItem[]): BoardItem[] {
  const byDate = new Map<string, BoardItem[]>();
  for (const it of items) {
    if (!it.date || !it.employeeId) continue;
    byDate.set(it.date, [...(byDate.get(it.date) ?? []), it]);
  }
  const out: BoardItem[] = [];
  const done = new Set<string>();
  for (const it of items) {
    const same = it.date && it.employeeId ? (byDate.get(it.date) ?? []) : [];
    if (same.length < 2) {
      out.push(it);
      continue;
    }
    if (done.has(it.date!)) continue;
    done.add(it.date!);
    out.push({
      key: mergedKey(it.kind, it.date!),
      kind: it.kind,
      employeeId: null,
      date: it.date,
      todo: null,
      age: null,
      office: null,
      extra: { kind: it.extra?.kind ?? (it.kind as ExtraKind), employeeId: null, date: it.date, params: { date: it.date!, count: same.length } },
      members: same,
    });
  }
  return out;
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
