import { addressChanges, addressFilingReasons, AddressPerson, addressTasks } from './address-filing';

const c = (p: Partial<AddressPerson['contact']> = {}) => ({
  postalCode: '1000001',
  address: '東京都千代田区1-1',
  livingPostalCode: null,
  livingAddress: null,
  overseasCountry: null,
  overseasCity: null,
  ...p,
});

describe('addressChanges：住所のどこが変わったか', () => {
  it('住民票の住所・居所・海外を分けて拾う', () => {
    expect(addressChanges(c(), c({ address: '大阪市1-1' }))).toEqual(['address']);
    expect(addressChanges(c(), c({ livingAddress: '寮' }))).toEqual(['livingAddress']);
    expect(addressChanges(c(), c({ overseasCountry: 'GB', overseasCity: 'London' }))).toEqual(['overseas']);
  });
  it('初めて入れたとき・前後の空白だけのときは変わっていない', () => {
    expect(addressChanges(c({ postalCode: null, address: null }), c())).toEqual([]);
    expect(addressChanges(c(), c({ address: ' 東京都千代田区1-1 ' }))).toEqual([]);
  });
});

describe('addressFilingReasons：住所変更届が要るかもしれない理由', () => {
  const p = (x: Partial<AddressPerson> = {}): AddressPerson => ({
    contact: c(),
    health: { enrolled: true },
    pension: { enrolled: true },
    noAddressReason: null,
    myNumberRegistered: true,
    ...x,
  });
  it('マイナンバー登録済みで、ふつうに住んでいる人は要らない', () => {
    expect(addressFilingReasons(p())).toEqual([]);
  });
  it('海外・短期在留・健保だけ・居所・マイナンバー未登録', () => {
    expect(addressFilingReasons(p({ contact: c({ overseasCountry: 'GB' }) }))).toEqual(['overseas']);
    expect(addressFilingReasons(p({ noAddressReason: 'shortStay' }))).toEqual(['shortStay']);
    expect(addressFilingReasons(p({ pension: { enrolled: false } }))).toEqual(['healthOnly']);
    expect(addressFilingReasons(p({ contact: c({ livingAddress: '寮' }) }))).toEqual(['living']);
    expect(addressFilingReasons(p({ myNumberRegistered: false }))).toEqual(['noMyNumber']);
    expect(addressFilingReasons(p({ myNumberRegistered: null }))).toEqual([]);
  });
});

describe('addressTasks：宿題', () => {
  it('変わっていなければ何も作らない', () => {
    expect(addressTasks('e1', [], ['overseas'], true, '2026-11-12')).toEqual([]);
  });
  it('理由があれば住所変更届、組合健保なら組合の確認も', () => {
    const t = addressTasks('e1', ['address'], ['noMyNumber'], true, '2026-11-12');
    expect(t.map((x) => x.kind)).toEqual(['address', 'addressKumiai']);
    expect(t[0].fields).toEqual(['address', 'reason_noMyNumber']);
  });
  it('理由がなく協会けんぽなら、何も作らない', () => {
    expect(addressTasks('e1', ['address'], [], false, '2026-11-12')).toEqual([]);
  });
});
