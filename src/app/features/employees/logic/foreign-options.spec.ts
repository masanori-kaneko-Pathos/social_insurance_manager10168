import { COUNTRY_CODES, countryOptions, needsWorkPermit, RESIDENCE_STATUSES } from './foreign-options';

describe('countryOptions：国籍の選択肢', () => {
  it('A〜Z の順、日本は入らない、重なりなし', () => {
    expect([...COUNTRY_CODES].sort()).toEqual([...COUNTRY_CODES]);
    expect(COUNTRY_CODES.includes('JP')).toBeFalse();
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
  });
  it('名前はその言語で', () => {
    expect(countryOptions('ja').find((c) => c.code === 'VN')?.name).toBe('ベトナム');
    expect(countryOptions('en').find((c) => c.code === 'VN')?.name).toBe('Vietnam');
  });
});

describe('在留資格', () => {
  it('外交・公用はいちばん下', () => {
    expect(RESIDENCE_STATUSES.slice(-2).map((s) => s.ja)).toEqual(['外交', '公用']);
  });
  it('留学・家族滞在は資格外活動の許可が要る。技人国は要らない', () => {
    expect(needsWorkPermit('留学')).toBeTrue();
    expect(needsWorkPermit('技術・人文知識・国際業務')).toBeFalse();
    expect(needsWorkPermit(null)).toBeFalse();
  });
});
