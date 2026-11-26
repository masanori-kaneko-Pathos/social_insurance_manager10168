/**
 * 同じ健康保険組合の料率を、ほかの事業所と写し合う（11/26）
 * - 組合は、両方に保険者番号があれば番号で、なければ名前で見分ける（名前は空白と全角・半角の違いだけそろえて比べる）
 * - 料率は事業所ごとに持ったまま（データの形は変えない）。写す・一緒に入れるのは、その事業所が組合に入っている期間の月だけ
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 */
import { HealthInsurer, InsurerPeriod, Office } from '../../../core/models/office';
import { KumiaiRateInput, MonthRange, RateSplit } from '../../../core/models/rates';
import { insurerHistoryOf, kumiaiRun } from '../../office/office-settings';
import { inRange } from './rate-changes';

/** 比べるための名前（全角・半角をそろえ、空白をすべて外す） */
export function kumiaiKey(name: string | null | undefined): string {
  return (name ?? '').normalize('NFKC').replace(/\s+/g, '');
}

export function sameKumiaiName(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const k = kumiaiKey(a);
  return k !== '' && k === kumiaiKey(b);
}

/** 組合を見分ける材料（名前と保険者番号） */
export type KumiaiId = Pick<HealthInsurer, 'kumiaiName' | 'insurerNumber'>;

/** 同じ組合か：両方に保険者番号があれば番号で、なければ名前で */
export function sameKumiai(a: KumiaiId, b: KumiaiId): boolean {
  if (a.insurerNumber && b.insurerNumber) return a.insurerNumber === b.insurerNumber;
  return sameKumiaiName(a.kumiaiName, b.kumiaiName);
}

type OfficeForShare = Pick<Office, 'prefecture' | 'healthInsurer'> &
  Partial<Pick<Office, 'insurerHistory'>>;

/** その事業所が、その組合に入っている期間（古い順。都道府県が変わっても同じ組合なら1つ） */
export function kumiaiRangesOf(office: OfficeForShare, kumiai: KumiaiId): MonthRange[] {
  const history: InsurerPeriod[] = insurerHistoryOf(office);
  const out: MonthRange[] = [];
  history.forEach((p, i) => {
    if (p.healthInsurer.type !== 'kumiai' || !sameKumiai(p.healthInsurer, kumiai)) return;
    const run = kumiaiRun(history, i);
    if (run && !out.some((r) => r.from === run.from)) out.push(run);
  });
  return out;
}

export interface KumiaiChoice {
  name: string;
  insurerNumber: string | null;
}

/**
 * 過去も含めて、知っている組合（名前の入力の候補。並びは名前の順）
 * 同じ名前は1つにまとめ、保険者番号が分かればそれを持つ
 */
export function kumiaiChoicesOf(offices: readonly OfficeForShare[]): KumiaiChoice[] {
  const seen = new Map<string, KumiaiChoice>();
  for (const o of offices) {
    for (const p of insurerHistoryOf(o)) {
      if (p.healthInsurer.type !== 'kumiai') continue;
      const name = (p.healthInsurer.kumiaiName ?? '').trim();
      if (!name) continue;
      const key = kumiaiKey(name);
      const prev = seen.get(key);
      if (!prev) seen.set(key, { name, insurerNumber: p.healthInsurer.insurerNumber ?? null });
      else if (!prev.insurerNumber && p.healthInsurer.insurerNumber) {
        prev.insurerNumber = p.healthInsurer.insurerNumber;
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

export interface ShareTarget {
  officeId: string;
  officeName: string;
  /** その事業所が、この組合に入っている期間 */
  ranges: MonthRange[];
}

/**
 * 同じ組合に入っている（入っていた）ほかの事業所
 * - adminUid を渡すと、その人が管理者の事業所だけ（書き込む「一緒に入れる」用）
 */
export function shareTargets(
  offices: readonly (OfficeForShare & Pick<Office, 'id' | 'name' | 'memberRoles'>)[],
  kumiai: KumiaiId,
  excludeOfficeId: string | null,
  adminUid: string | null = null,
): ShareTarget[] {
  if (!kumiaiKey(kumiai.kumiaiName) && !kumiai.insurerNumber) return [];
  return offices
    .filter((o) => o.id !== excludeOfficeId)
    .filter((o) => adminUid === null || o.memberRoles[adminUid] === 'admin')
    .map((o) => ({ officeId: o.id, officeName: o.name, ranges: kumiaiRangesOf(o, kumiai) }))
    .filter((t) => t.ranges.length > 0);
}

function sameSplit(a: RateSplit, b: RateSplit): boolean {
  return a.employee === b.employee && a.employer === b.employer;
}

function sameRate(a: KumiaiRateInput, b: KumiaiRateInput): boolean {
  return (
    sameSplit(a.health, b.health) &&
    sameSplit(a.care, b.care) &&
    sameSplit(a.childSupport, b.childSupport)
  );
}

export interface SharePlan {
  /** 書く行（saveKumiaiMany にそのまま渡せる形） */
  items: { input: KumiaiRateInput; exists: boolean }[];
  count: { new: number; update: number; same: number; outside: number };
}

/** ほかの事業所に入れたら、どうなるか（期間の外の月は入れない。値が同じ行は書かない） */
export function sharePlan(
  rates: readonly KumiaiRateInput[],
  existing: readonly KumiaiRateInput[],
  ranges: readonly MonthRange[],
): SharePlan {
  const count = { new: 0, update: 0, same: 0, outside: 0 };
  const items: SharePlan['items'] = [];
  for (const r of rates) {
    if (!ranges.some((range) => inRange(r.from, range))) {
      count.outside++;
      continue;
    }
    const old = existing.find((k) => k.from === r.from);
    if (!old) {
      count.new++;
      items.push({ input: r, exists: false });
    } else if (sameRate(old, r)) {
      count.same++;
    } else {
      count.update++;
      items.push({ input: r, exists: true });
    }
  }
  return { items, count };
}
