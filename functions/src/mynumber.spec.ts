import { randomBytes } from 'node:crypto';
import { keyFrom, open, seal } from './mynumber-crypto';
import { canSubmit, checkDigitOf, isRecentAuth, isValidMyNumber, keepsVault, nextStatus, normalizeMyNumber } from './mynumber-rules';

describe('マイナンバー：番号の形', () => {
  it('チェックデジット（作り物の番号で）', () => {
    expect(checkDigitOf('11111111111')).toBe(8);
    expect(isValidMyNumber('111111111118')).toBeTrue();
    expect(isValidMyNumber('111111111119')).toBeFalse();
    expect(isValidMyNumber('11111111111')).toBeFalse();
  });
  it('全角・ハイフン・空白をのぞく', () => {
    expect(normalizeMyNumber('１１１１－１１１１ 1118')).toBe('111111111118');
  });
});

describe('マイナンバー：状態', () => {
  it('依頼 → 提出 → 登録、差し戻し', () => {
    expect(nextStatus(null, 'request')).toEqual({ ok: true, next: 'requested' });
    expect(canSubmit('requested')).toBeTrue();
    expect(nextStatus('submitted', 'approve')).toEqual({ ok: true, next: 'registered' });
    expect(nextStatus('submitted', 'return')).toEqual({ ok: true, next: 'returned' });
    expect(canSubmit('returned')).toBeTrue();
    expect(canSubmit('registered')).toBeFalse();
  });
  it('できない操作', () => {
    expect(nextStatus('registered', 'request').ok).toBeFalse();
    expect(nextStatus(null, 'approve').ok).toBeFalse();
    expect(nextStatus('registered', 'refuse').ok).toBeFalse();
  });
  it('廃棄で未登録に戻り、金庫から消す', () => {
    expect(nextStatus('registered', 'dispose')).toEqual({ ok: true, next: null });
    expect(keepsVault(null)).toBeFalse();
    expect(keepsVault('returned')).toBeFalse();
    expect(keepsVault('submitted')).toBeTrue();
  });
  it('ログインし直して5分以内', () => {
    expect(isRecentAuth(1000, 1000 + 300)).toBeTrue();
    expect(isRecentAuth(1000, 1000 + 301)).toBeFalse();
    expect(isRecentAuth(undefined, 1000)).toBeFalse();
  });
});

describe('マイナンバー：暗号化', () => {
  const key = keyFrom(randomBytes(32).toString('base64'));
  it('同じ場所なら開ける・別の場所や改ざんでは開けない', () => {
    const s = seal(key, '111111111118', 'o1/e1');
    expect(s.data).not.toContain('1111');
    expect(open(key, s, 'o1/e1')).toBe('111111111118');
    expect(() => open(key, s, 'o1/e2')).toThrow();
    expect(() => open(key, { ...s, data: Buffer.from('x').toString('base64') }, 'o1/e1')).toThrow();
  });
  it('鍵が32バイトでなければ止める', () => {
    expect(() => keyFrom('abc')).toThrow();
    expect(() => keyFrom(undefined)).toThrow();
  });
});
