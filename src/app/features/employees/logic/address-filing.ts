// 住所が変わったときの届出の宿題（被保険者住所変更届・組合への届け）
// Angular・Firebase に依存しない純粋な関数
//
// 根拠（11/12 に本人が確認）
// - マイナンバーと基礎年金番号が結びついている人は、住民票の住所の変更が年金機構に自動で反映されるので、
//   被保険者住所変更届は原則いらない
// - 要るのは：健康保険だけに入っている人・海外に住む人・短期在留の外国人・住民票以外の居所を登録する人・
//   マイナンバーと基礎年金番号が結びついていない人（日本年金機構「被保険者住所変更届」）
// - 組合健保は、組合が独自に住所の届けを求めることがある → 組合の決まりを確かめる宿題
// - 初めて住所を入れたとき（入社の登録など）は「変わった」ではない（住所は資格取得届に書く）

import type { ContactDoc } from '../../../core/models/employee';
import type { FilingTaskInput } from '../../../core/models/filing-task';

export type AddressField = 'address' | 'livingAddress' | 'overseas';
export type AddressFilingReason = 'overseas' | 'shortStay' | 'healthOnly' | 'living' | 'noMyNumber';

type AddressPart = Pick<
  ContactDoc,
  'postalCode' | 'address' | 'livingPostalCode' | 'livingAddress' | 'overseasCountry' | 'overseasCity'
>;

const v = (s: string | null | undefined) => (s ?? '').trim();

/** 住所のどこが変わったか。前に何も入っていなかった（初めて入れた）ときは空 */
export function addressChanges(before: AddressPart, after: AddressPart): AddressField[] {
  const hadAny = [before.postalCode, before.address, before.livingAddress, before.overseasCountry].some((x) => v(x) !== '');
  if (!hadAny) return [];
  const out: AddressField[] = [];
  if (v(before.postalCode) !== v(after.postalCode) || v(before.address) !== v(after.address)) out.push('address');
  if (v(before.livingPostalCode) !== v(after.livingPostalCode) || v(before.livingAddress) !== v(after.livingAddress)) {
    out.push('livingAddress');
  }
  if (v(before.overseasCountry) !== v(after.overseasCountry) || v(before.overseasCity) !== v(after.overseasCity)) {
    out.push('overseas');
  }
  return out;
}

export interface AddressPerson {
  contact: AddressPart;
  health: { enrolled: boolean };
  pension: { enrolled: boolean };
  /** 外国籍の欄の「住所を書けない理由」 */
  noAddressReason: 'overseas' | 'shortStay' | 'other' | null;
  /** マイナンバーが登録済みか（null ＝ わからない） */
  myNumberRegistered: boolean | null;
}

/** 被保険者住所変更届が要るかもしれない理由（変わったあとの状態で見る） */
export function addressFilingReasons(p: AddressPerson): AddressFilingReason[] {
  const out: AddressFilingReason[] = [];
  if (v(p.contact.overseasCountry) !== '' || p.noAddressReason === 'overseas') out.push('overseas');
  if (p.noAddressReason === 'shortStay') out.push('shortStay');
  if (p.health.enrolled && !p.pension.enrolled) out.push('healthOnly');
  if (v(p.contact.livingAddress) !== '') out.push('living');
  if (p.myNumberRegistered === false) out.push('noMyNumber');
  return out;
}

/** 住所が変わったときの宿題（届が要らなそうなら、組合健保の確認だけ） */
export function addressTasks(
  employeeId: string,
  fields: readonly AddressField[],
  reasons: readonly AddressFilingReason[],
  kumiai: boolean,
  factDate: string,
): FilingTaskInput[] {
  if (fields.length === 0) return [];
  const tasks: FilingTaskInput[] = [];
  if (reasons.length > 0) {
    tasks.push({ kind: 'address', employeeId, factDate, fields: [...fields, ...reasons.map((r) => `reason_${r}`)] });
  }
  if (kumiai) tasks.push({ kind: 'addressKumiai', employeeId, factDate, fields: [...fields] });
  return tasks;
}
