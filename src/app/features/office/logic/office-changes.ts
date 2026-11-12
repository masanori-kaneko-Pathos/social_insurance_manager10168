// 事業所の設定の「届が要る変更」を見つける（保存の前とあとを比べる）
// Angular・Firebase に依存しない純粋な関数
//
// 根拠（日本年金機構。11/12 に本人が確認。どれも事実発生から5日以内）
// - 適用事業所名称／所在地変更（訂正）届：名称・所在地（管轄の外へ移ると管轄の年金事務所と協会けんぽの料率が変わる）
// - 事業所関係変更（訂正）届：事業主の変更・氏名の変更、賞与支払予定月、現物給与の種類、法人番号、健康保険組合の名称 など

export interface OfficeChangeSource {
  name: string;
  postalCode: string | null;
  address: string;
  prefecture: string;
  ownerName: string;
  corporateNumber: string | null;
  healthInsurer: { type: 'kyokai' | 'kumiai'; kumiaiName: string | null };
  bonusMonths: readonly number[];
  inKind: { housing: boolean; meals: boolean };
}

export type NameAddressField = 'name' | 'postalCode' | 'address' | 'prefecture';
export type RelationField = 'ownerName' | 'corporateNumber' | 'kumiaiName' | 'bonusMonths' | 'inKind';

export interface OfficeChanges {
  nameAddress: NameAddressField[];
  relation: RelationField[];
  /** 都道府県が変わった（管轄の外へ。協会けんぽなら料率も変わることがある） */
  prefectureChanged: boolean;
}

const same = (a: string | null, b: string | null) => (a ?? '').trim() === (b ?? '').trim();
const sameMonths = (a: readonly number[], b: readonly number[]) =>
  [...a].sort((x, y) => x - y).join(',') === [...b].sort((x, y) => x - y).join(',');

export function officeChanges(before: OfficeChangeSource, after: OfficeChangeSource): OfficeChanges {
  const nameAddress: NameAddressField[] = [];
  if (!same(before.name, after.name)) nameAddress.push('name');
  if (!same(before.postalCode, after.postalCode)) nameAddress.push('postalCode');
  if (!same(before.address, after.address)) nameAddress.push('address');
  if (before.prefecture !== after.prefecture) nameAddress.push('prefecture');

  const relation: RelationField[] = [];
  if (!same(before.ownerName, after.ownerName)) relation.push('ownerName');
  if (!same(before.corporateNumber, after.corporateNumber)) relation.push('corporateNumber');
  // 組合の名前：組合健保のまま名前が変わったとき（協会けんぽ ⇔ 組合の切り替えは保険者の履歴の話）
  if (
    before.healthInsurer.type === 'kumiai' &&
    after.healthInsurer.type === 'kumiai' &&
    !same(before.healthInsurer.kumiaiName, after.healthInsurer.kumiaiName)
  ) {
    relation.push('kumiaiName');
  }
  if (!sameMonths(before.bonusMonths, after.bonusMonths)) relation.push('bonusMonths');
  if (before.inKind.housing !== after.inKind.housing || before.inKind.meals !== after.inKind.meals) {
    relation.push('inKind');
  }
  return { nameAddress, relation, prefectureChanged: before.prefecture !== after.prefecture };
}

export function hasOfficeChanges(c: OfficeChanges | null): boolean {
  return !!c && (c.nameAddress.length > 0 || c.relation.length > 0);
}
