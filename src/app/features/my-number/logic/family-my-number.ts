// 家族（被扶養者）のマイナンバー：届の添付を省けるか・本人確認・廃棄の目安
// Angular・Firebase に依存しない純粋な関数
//
// 被扶養者（異動）届の「続柄」の書類（戸籍謄本・住民票）は、次の両方がそろえば省ける（日本年金機構の添付書類等一覧）
//   ア：被保険者と扶養認定を受ける人の「個人番号」欄に、それぞれの番号を書く
//   イ：事業主が戸籍謄本などで続柄を確かめ、備考欄の「続柄確認済み」に✓をつける
// 本人確認（番号法16条）
//   - 配偶者（国民年金の第3号被保険者）：会社が確認するのが原則。会社が従業員に確認の事務を任せる方法もある（どれにするかは会社が決める）
//   - そのほかの扶養家族：従業員が確認する扱い（個人情報保護委員会の FAQ。年末調整の書類の扱いからの類推）。
//     会社が番号を確かめるために書類を見るのはかまわない

import type { MyNumberEntry, MyNumberStatus } from '../../../core/models/my-number';
import { DateStr } from '../../../shared/utils/date';
import { hasNumber, KEEP_YEARS } from './my-number';

export type AttachMissing = 'selfNumber' | 'familyNumber' | 'relationship';

/** 続柄の書類を省けるか（足りないもの） */
export function attachOmission(
  selfStatus: MyNumberStatus | null,
  family: Pick<MyNumberEntry, 'status'> | null,
  relationshipConfirmed: boolean,
): { ok: boolean; missing: AttachMissing[] } {
  const missing: AttachMissing[] = [];
  if (selfStatus !== 'registered') missing.push('selfNumber');
  if (family?.status !== 'registered') missing.push('familyNumber');
  if (!relationshipConfirmed) missing.push('relationship');
  return { ok: missing.length === 0, missing };
}

/** 配偶者の番号を、従業員が本人確認したことになっている（会社から任せている場合だけ） */
export function spouseVerifyWarning(
  relationship: string,
  entry: Pick<MyNumberEntry, 'verifiedBy'> | null,
): boolean {
  return relationship === 'spouse' && entry?.verifiedBy === 'employee';
}

function addYears(d: DateStr, years: number): DateStr {
  const md = d.slice(5) === '02-29' ? '03-01' : d.slice(5);
  return `${Number(d.slice(0, 4)) + years}-${md}`;
}

/** 扶養を外れた家族の番号を廃棄してよい日（外れた日から2年）。まだ扶養・番号がないなら null */
export function familyDisposalDate(dependentTo: DateStr | null, entry: Pick<MyNumberEntry, 'status'> | null): DateStr | null {
  if (!dependentTo || !entry || !hasNumber(entry.status)) return null;
  return addYears(dependentTo, KEEP_YEARS);
}
