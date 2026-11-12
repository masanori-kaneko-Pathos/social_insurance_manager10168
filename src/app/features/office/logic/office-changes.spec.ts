import { hasOfficeChanges, OfficeChangeSource, officeChanges } from './office-changes';

const base: OfficeChangeSource = {
  name: '伊藤テスト中商事',
  postalCode: '1000001',
  address: '千代田区1-1',
  prefecture: '13',
  ownerName: '伊藤 一郎',
  corporateNumber: '1234567890123',
  healthInsurer: { type: 'kyokai', kumiaiName: null },
  bonusMonths: [6, 12],
  inKind: { housing: false, meals: false },
};

describe('officeChanges：届が要る変更', () => {
  it('何も変わらなければ空（前後の空白・賞与の月の並びは気にしない）', () => {
    const c = officeChanges(base, { ...base, name: ' 伊藤テスト中商事 ', bonusMonths: [12, 6] });
    expect(hasOfficeChanges(c)).toBeFalse();
  });
  it('名称・所在地は名称／所在地変更届、都道府県が変われば印', () => {
    const c = officeChanges(base, { ...base, address: '大阪市1-1', prefecture: '27' });
    expect(c.nameAddress).toEqual(['address', 'prefecture']);
    expect(c.prefectureChanged).toBeTrue();
    expect(c.relation).toEqual([]);
  });
  it('事業主・法人番号・賞与の月・現物は事業所関係変更届', () => {
    const c = officeChanges(base, {
      ...base,
      ownerName: '伊藤 二郎',
      corporateNumber: null,
      bonusMonths: [7, 12],
      inKind: { housing: true, meals: false },
    });
    expect(c.relation).toEqual(['ownerName', 'corporateNumber', 'bonusMonths', 'inKind']);
  });
  it('組合の名前は組合健保のまま変わったときだけ', () => {
    const k = { ...base, healthInsurer: { type: 'kumiai' as const, kumiaiName: 'A健保' } };
    expect(officeChanges(k, { ...k, healthInsurer: { type: 'kumiai', kumiaiName: 'B健保' } }).relation).toEqual(['kumiaiName']);
    expect(officeChanges(base, k).relation).toEqual([]);
  });
});
