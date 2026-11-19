/**
 * 賞与の項目（core/models/bonus-item.ts）を、支給に当てる。11/19
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 *
 * - 支給の名前（nature。空は「賞与」）が、項目の名前か取り込みの名前に当たれば、その項目に寄せる
 *   → 回数は項目ごとに数える（夏季賞与と冬季賞与を同じ項目にすれば合わせて数える）
 * - 当たらない名前は、今までどおり「名前ごと・回数で判定」
 * - 社会保険の扱いは定時決定の年ごと。変えたら次の7月1日（次の定時決定の年）から効く
 */
import {
  BonusItemInput,
  BonusTreatment,
  BonusTreatmentPeriod,
} from '../../../core/models/bonus-item';
import { DateStr } from '../../../shared/utils/date';

/** 支給に付ける、項目の決まり（保存はしない。計算のときだけ） */
export interface ItemRule {
  name: string;
  plannedCount: number | null;
  treatments: readonly BonusTreatmentPeriod[];
}

export type ItemLike = Pick<BonusItemInput, 'name' | 'labels' | 'plannedCount' | 'treatments'> & { id?: string };

export const ITEM_NAME_MAX = 30; // 支給の nature と同じ上限（firestore.rules）
export const ITEM_LABELS_MAX = 20;

const norm = (s: string | null | undefined) => (s ?? '').trim();

/** その定時決定の年の扱い（項目がなければ「回数で判定」） */
export function treatmentAt(rule: Pick<ItemRule, 'treatments'> | null | undefined, year: number): BonusTreatment {
  let best: BonusTreatmentPeriod | null = null;
  for (const t of rule?.treatments ?? []) {
    if (t.fromYear <= year && (!best || t.fromYear >= best.fromYear)) best = t;
  }
  return best?.treatment ?? 'count';
}

/** 今の扱い（いちばん新しい期間） */
export function currentTreatment(rule: Pick<ItemRule, 'treatments'>): BonusTreatmentPeriod | null {
  return [...rule.treatments].sort((a, b) => b.fromYear - a.fromYear)[0] ?? null;
}

/** 次の7月1日の年（今日が7月1日より前ならその年、7月1日からは次の年） */
export function nextDecisionYear(today: DateStr): number {
  const y = Number(today.slice(0, 4));
  return today.slice(5) < '07-01' ? y : y + 1;
}

/** 名前（項目の名前・取り込みの名前） → 項目 */
export function itemIndex<T extends ItemLike>(items: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const it of items) {
    for (const l of it.labels) if (norm(l)) map.set(norm(l), it);
  }
  for (const it of items) map.set(norm(it.name), it); // 項目の名前を優先
  return map;
}

/** 支給に、項目のまとまり（group）と決まり（rule）を付ける。当たらない支給はそのまま */
export function resolveItems<T extends { nature?: string | null }>(
  payments: readonly T[],
  items: readonly ItemLike[],
  defaultName: string,
): (T & { group?: string; rule?: ItemRule })[] {
  if (items.length === 0) return [...payments];
  const index = itemIndex(items);
  return payments.map((p) => {
    const it = index.get(norm(p.nature) || defaultName);
    return it
      ? { ...p, group: it.name, rule: { name: it.name, plannedCount: it.plannedCount, treatments: it.treatments } }
      : p;
  });
}

// ===== 編集 =====

export type ItemError = 'nameRequired' | 'nameTooLong' | 'duplicate' | 'plannedCount' | 'tooManyLabels';

/** 入力の確かめ（others：ほかの項目。名前・取り込みの名前は全部の項目で重ならない） */
export function validateItem(input: ItemLike, others: readonly ItemLike[]): ItemError[] {
  const errors: ItemError[] = [];
  const name = norm(input.name);
  if (!name) errors.push('nameRequired');
  if (name.length > ITEM_NAME_MAX || input.labels.some((l) => norm(l).length > ITEM_NAME_MAX)) errors.push('nameTooLong');
  if (input.labels.length > ITEM_LABELS_MAX) errors.push('tooManyLabels');
  const taken = new Set(others.flatMap((o) => [norm(o.name), ...o.labels.map(norm)]));
  if ([name, ...input.labels.map(norm)].some((n) => n && taken.has(n))) errors.push('duplicate');
  const c = input.plannedCount;
  if (c !== null && (!Number.isInteger(c) || c < 1 || c > 12)) errors.push('plannedCount');
  return errors;
}

/** 取り込みの名前を、カンマ・読点・改行で分けて、空・重なり・項目の名前を除く */
export function parseLabels(text: string, name: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,、，\n]/)) {
    const l = norm(raw);
    if (l && l !== norm(name) && !out.includes(l)) out.push(l);
  }
  return out;
}

/** 名前を変えたら、古い名前を取り込みの名前に足す（過去の支給が当たり続けるように） */
export function withRename(before: ItemLike | null, after: ItemLike): ItemLike {
  if (!before || norm(before.name) === norm(after.name)) return after;
  const labels = after.labels.includes(norm(before.name)) ? after.labels : [...after.labels, norm(before.name)];
  return { ...after, labels: labels.filter((l) => l !== norm(after.name)) };
}

/**
 * 扱いを変える
 * - まだ支給に使っていない項目：最初から（fromYear 0）の1つに置き換える
 *   ただし「年4回以上の賞与」は、規程を新しく作ったなら次の定時決定までは賞与（課長通知 1(3)・令和5年 Q&A Q4）
 *   → 前からある規程（ruleExisted）でなければ、それまでは「回数で判定」にしておく（11/19）
 * - 使っている項目：次の定時決定の年から。同じ年の変更は上書き、今と同じなら何もしない
 */
export function withTreatment(
  treatments: readonly BonusTreatmentPeriod[],
  treatment: BonusTreatment,
  used: boolean,
  today: DateStr,
  ruleExisted = false,
): BonusTreatmentPeriod[] {
  if (!used || treatments.length === 0) {
    return treatment === 'remuneration' && !ruleExisted
      ? [{ fromYear: 0, treatment: 'count' }, { fromYear: nextDecisionYear(today), treatment }]
      : [{ fromYear: 0, treatment }];
  }
  const from = nextDecisionYear(today);
  const kept = treatments.filter((t) => t.fromYear < from);
  if (treatmentAt({ treatments: kept }, from) === treatment) return kept.length > 0 ? kept : [{ fromYear: 0, treatment }];
  return [...kept, { fromYear: from, treatment }];
}

/** 項目に当たる名前の支給があるか（扱いの変更・取り込みの名前の削除で使う） */
export function namesInUse(payments: readonly { nature?: string | null }[], defaultName: string): Set<string> {
  return new Set(payments.map((p) => norm(p.nature) || defaultName));
}
