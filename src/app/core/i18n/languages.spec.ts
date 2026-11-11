import { isLang, LANG_CODES, LANGUAGES, localeOf } from './languages';

describe('languages：言語の一覧', () => {
  it('コードが重ならない。日本語が最初（初期の言語）', () => {
    expect(new Set(LANG_CODES).size).toBe(LANGUAGES.length);
    expect(LANG_CODES[0]).toBe('ja');
  });
  it('isLang・localeOf', () => {
    expect(isLang('en')).toBeTrue();
    expect(isLang('xx')).toBeFalse();
    expect(isLang(null)).toBeFalse();
    expect(localeOf('en')).toBe('en-US');
    expect(localeOf('xx')).toBe('ja-JP');
  });
});
