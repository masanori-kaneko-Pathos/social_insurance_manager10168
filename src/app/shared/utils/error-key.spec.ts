import { errorKeyOf } from './error-key';

describe('errorKeyOf（失敗の知らせを原因で分ける。11/16）', () => {
  it('権限がない・つながらない・それ以外', () => {
    expect(errorKeyOf({ code: 'permission-denied' }, 'x.error.save')).toBe('common.error.permission');
    expect(errorKeyOf({ code: 'unavailable' }, 'x.error.save')).toBe('common.error.offline');
    expect(errorKeyOf({ code: 'deadline-exceeded' }, 'x.error.save')).toBe('common.error.offline');
    expect(errorKeyOf({ code: 'invalid-argument' }, 'x.error.save')).toBe('x.error.save');
    expect(errorKeyOf(new Error('boom'), 'x.error.save')).toBe('x.error.save');
    expect(errorKeyOf(null, 'x.error.save')).toBe('x.error.save');
  });
});
