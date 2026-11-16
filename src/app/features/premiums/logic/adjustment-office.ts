// 保険料調整制度：事業所が使えるか・申出の期限と、1人分の軽減割合を出す関数をつくる（11/16）
// Angular・Firebase に依存しない純粋な関数
//
// 対象の事業所（日本年金機構「保険料調整制度のご案内」R48。この画面で分かる2つ）
// - 2026年10月〜2035年9月に任意特定適用事業所になった（任意特定）
// - 2027年10月以後の適用拡大（企業規模の要件の引き下げ）で特定適用事業所になった（該当）
// 2026年10月1日より前から特定適用事業所（任意特定を含む）なら対象外
// 申出の期限：該当した日から2年を経過した日が属する月の前月まで（例：2026年10月に該当 → 2028年9月まで）
// ※ 任意適用の個人事業所の場合（案内の（3）（4））は、この画面の設定からは分からないので、人が判断する

import type { SpecificApplication, StandardHours } from '../../../core/models/office';
import type { ContractDoc } from '../../../core/models/contract';
import type { Employee } from '../../../core/models/employee';
import type { ClassifyCriteria } from '../../employees/logic/classify';
import { insurerFor } from '../../office/office-settings';
import { shiftMonth } from '../../../shared/utils/date';
import type { RemunerationLike } from './calc-monthly';
import { adjustmentResolver } from './adjustment-eligibility';
import type { AdjustmentInput } from './premium-adjustment';

export type AdjustmentOfficeBasis = 'voluntary' | 'expansion';

export interface AdjustmentOfficeStatus {
  /** 対象になりうる（設定からそう読める） */
  eligible: boolean;
  basis: AdjustmentOfficeBasis | null;
  /** 申出の期限（この月の末日まで）。対象でなければ null */
  deadline: string | null;
  /** 対象外の理由（2026年9月以前から特定適用事業所／特定適用事業所でない） */
  reason: 'before' | 'notSpecific' | null;
}

export function adjustmentOfficeStatus(s: Pick<SpecificApplication, 'since' | 'voluntary'> | null | undefined): AdjustmentOfficeStatus {
  const none = (reason: AdjustmentOfficeStatus['reason']): AdjustmentOfficeStatus => ({ eligible: false, basis: null, deadline: null, reason });
  if (!s?.since) return none('notSpecific');
  if (s.since < '2026-10') return none('before');
  if (s.voluntary) {
    if (s.since > '2035-09') return none('notSpecific');
    return { eligible: true, basis: 'voluntary', deadline: shiftMonth(s.since, 23), reason: null };
  }
  if (s.since >= '2027-10') return { eligible: true, basis: 'expansion', deadline: shiftMonth(s.since, 23), reason: null };
  // 2026-10〜2027-09 に（任意でなく）特定適用事業所になった：51人以上の要件で該当した事業所は対象外
  return none('before');
}

/** 保険料の計算に要る事業所の設定 */
export interface AdjustmentOffice {
  prefecture: string;
  healthInsurer: Parameters<typeof insurerFor>[0]['healthInsurer'];
  insurerHistory?: Parameters<typeof insurerFor>[0]['insurerHistory'];
  standardHours: StandardHours | null;
  specificApplication: SpecificApplication;
  since: string | null;
}

/**
 * 1人分の「月 → 軽減割合」をつくる（使っていない事業所・材料がない人は、いつも null を返す）
 * 区分（短時間労働者か）は、雇用契約から月末日で判定する（加入の判定と同じ classify）
 */
export function adjustmentForEmployee(
  office: AdjustmentOffice,
  employee: Pick<Employee, 'birthDate' | 'optInDate' | 'optOutDate' | 'health' | 'pension'>,
  contracts: readonly ContractDoc[],
  criteria: readonly ClassifyCriteria[],
  remunerations: RemunerationLike[],
): (month: string) => AdjustmentInput | null {
  if (!office.since) return () => null;
  return adjustmentResolver({
    since: office.since,
    person: {
      birthDate: employee.birthDate,
      optInDate: employee.optInDate ?? null,
      optOutDate: employee.optOutDate ?? null,
      contracts: [...contracts],
    },
    employee,
    remunerations,
    office: { standardHours: office.standardHours, specificApplication: office.specificApplication },
    criteria: [...criteria],
    kumiaiAt: (month) => insurerFor(office, month)?.healthInsurer.type === 'kumiai',
  });
}
