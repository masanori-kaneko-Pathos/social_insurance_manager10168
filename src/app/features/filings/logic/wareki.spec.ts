import { toWareki, toWarekiMonth } from './wareki';

describe('wareki：和暦', () => {
  it('令和・平成・昭和と元年', () => {
    expect(toWareki('2026-01-05')).toBe('令和8年1月5日');
    expect(toWareki('2019-05-01')).toBe('令和元年5月1日');
    expect(toWareki('2019-04-30')).toBe('平成31年4月30日');
    expect(toWareki('1989-01-07')).toBe('昭和64年1月7日');
    expect(toWareki('1955-12-05')).toBe('昭和30年12月5日');
  });
  it('年月。読めないものはそのまま', () => {
    expect(toWarekiMonth('2026-09')).toBe('令和8年9月');
    expect(toWarekiMonth('2019-05')).toBe('令和元年5月');
    expect(toWareki('')).toBe('');
    expect(toWareki('abc')).toBe('abc');
  });
});
