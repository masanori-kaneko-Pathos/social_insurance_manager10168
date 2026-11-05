/**
 * 期間の中の料率の移り変わり（料率の窓で使う）
 * Angular・Firebase に依存しない純粋な関数だけで書く。
 */
import { MasterRateDoc, MonthRange, RatesForMonth } from '../../../core/models/rates';
import { pickRates } from './pick-rates';

/** 健康保険の窓に出す種類（厚年・拠出金は保険者に関係ないので出さない） */
const HEALTH_KINDS = new Set<MasterRateDoc['kind']>(['kyokaiHealth', 'care', 'childSupport']);

/** その月が期間の中か（to の月は含まない。to が null なら今も続いている） */
export function inRange(month: string, range: MonthRange): boolean {
  return month >= range.from && (range.to === null || month < range.to);
}

/**
 * 協会けんぽの期間の中で、健保・介護・支援金の料率が変わる月ごとの一覧（古い順）
 * - 期間の始まりの月：その月に効いている料率（期間より前に決まった料率も含む）
 * - 期間の中で料率が変わった月：その月からの料率
 * どれも料率がない月（「登録時から」の始まりなど）は出さない
 */
export function kyokaiChanges(
  master: MasterRateDoc[],
  prefecture: string,
  range: MonthRange,
): RatesForMonth[] {
  const months = new Set<string>([range.from]);
  for (const d of master) {
    if (HEALTH_KINDS.has(d.kind) && inRange(d.from, range)) months.add(d.from);
  }
  const office = { prefecture, healthInsurer: { type: 'kyokai' as const } };
  return [...months]
    .sort()
    .map((m) => pickRates(office, { master, kumiai: [] }, m))
    .filter((r) => r.health || r.care || r.childSupport);
}
