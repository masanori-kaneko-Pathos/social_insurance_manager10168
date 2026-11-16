import { adjustmentOfficeStatus } from './adjustment-office';

describe('adjustmentOfficeStatus（保険料調整制度を使える事業所か・申出の期限。11/16）', () => {
  it('2026年10月以後に任意特定 → 対象。期限は2年を経過した月の前月', () => {
    expect(adjustmentOfficeStatus({ since: '2026-10', voluntary: true })).toEqual({ eligible: true, basis: 'voluntary', deadline: '2028-09', reason: null });
    expect(adjustmentOfficeStatus({ since: '2026-12', voluntary: true }).deadline).toBe('2028-11');
  });
  it('2027年10月以後の適用拡大で該当 → 対象', () => {
    expect(adjustmentOfficeStatus({ since: '2027-10', voluntary: false })).toEqual({ eligible: true, basis: 'expansion', deadline: '2029-09', reason: null });
  });
  it('2026年9月以前から特定適用事業所・51人以上で該当・特定適用事業所でない → 対象外', () => {
    expect(adjustmentOfficeStatus({ since: '2024-10', voluntary: false }).reason).toBe('before');
    expect(adjustmentOfficeStatus({ since: '2025-04', voluntary: true }).reason).toBe('before');
    expect(adjustmentOfficeStatus({ since: '2027-03', voluntary: false }).reason).toBe('before');
    expect(adjustmentOfficeStatus({ since: null, voluntary: false }).reason).toBe('notSpecific');
    expect(adjustmentOfficeStatus(null).eligible).toBeFalse();
  });
});
