import { certificateValidOn, certificateWarnings, defaultCovers, exemptOn } from './agreement';

const MASTER = [
  { country: 'US', from: '2005-10', covers: 'pensionAndHealth' as const },
  { country: 'DE', from: '2000-02', covers: 'pension' as const },
  { country: 'AT', from: '2025-12', covers: 'pension' as const },
];
const TODAY = '2026-11-09';
const cert = (p: Partial<{ country: string; from: string; to: string | null; covers: 'pension' | 'pensionAndHealth' }>) => ({
  country: 'US',
  from: '2026-04-01',
  to: '2029-03-31',
  covers: 'pensionAndHealth' as const,
  ...p,
});

describe('exemptOn：その日に免除される保険', () => {
  it('アメリカの証明書（年金・医療）', () => {
    expect(exemptOn(cert({}), TODAY)).toEqual({ pension: true, health: true });
  });

  it('ドイツの証明書（年金だけ）', () => {
    expect(exemptOn(cert({ country: 'DE', covers: 'pension' }), TODAY)).toEqual({ pension: true, health: false });
  });

  it('期間の外・証明書なしは免除なし', () => {
    expect(exemptOn(cert({}), '2029-04-01')).toEqual({ pension: false, health: false });
    expect(exemptOn(null, TODAY)).toEqual({ pension: false, health: false });
  });

  it('終わりの日は含む', () => {
    expect(certificateValidOn(cert({}), '2029-03-31')).toBeTrue();
    expect(certificateValidOn(cert({}), '2026-03-31')).toBeFalse();
  });
});

describe('certificateWarnings：マスタとの照らし合わせ', () => {
  it('問題なし', () => {
    expect(certificateWarnings(cert({}), MASTER, TODAY)).toEqual([]);
  });

  it('協定のない国', () => {
    expect(certificateWarnings(cert({ country: 'TH' }), MASTER, TODAY)).toContain('noAgreement');
  });

  it('発効より前から', () => {
    expect(certificateWarnings(cert({ country: 'AT', covers: 'pension', from: '2025-06-01' }), MASTER, TODAY)).toEqual([
      'beforeEffective',
    ]);
  });

  it('オーストリアで医療も免除にしている（※3：日本の医療保険には入る）', () => {
    expect(certificateWarnings(cert({ country: 'AT' }), MASTER, TODAY)).toEqual(['coversWider']);
  });

  it('アメリカで年金だけにしている', () => {
    expect(certificateWarnings(cert({ covers: 'pension' }), MASTER, TODAY)).toEqual(['coversNarrower']);
  });

  it('終わりなし・切れている・まもなく切れる', () => {
    expect(certificateWarnings(cert({ to: null }), MASTER, TODAY)).toEqual(['noEnd']);
    expect(certificateWarnings(cert({ to: '2026-10-31' }), MASTER, TODAY)).toEqual(['expired']);
    expect(certificateWarnings(cert({ to: '2026-12-31' }), MASTER, TODAY)).toEqual(['expiringSoon']);
  });
});

describe('defaultCovers', () => {
  it('マスタの範囲。協定がなければ null', () => {
    expect(defaultCovers('US', MASTER)).toBe('pensionAndHealth');
    expect(defaultCovers('TH', MASTER)).toBeNull();
  });
});
