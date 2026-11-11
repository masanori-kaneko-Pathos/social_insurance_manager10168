import { MyNumberEntry } from '../../../core/models/my-number';
import {
  adminActions,
  disposalDue,
  formatMyNumber,
  isValidMyNumber,
  lossDateOf,
  myNumberProblem,
  normalizeMyNumber,
} from './my-number';

const reg: MyNumberEntry = { status: 'registered', docType: 'card', note: null, by: 'admin', updatedAt: '' };
const person = (o: Partial<Parameters<typeof lossDateOf>[0]> = {}) => ({
  id: 'e1',
  retireDate: '2024-03-31',
  health: { enrolled: true, lostDate: '2024-04-01' },
  pension: { enrolled: true, lostDate: '2024-04-01' },
  ...o,
});

describe('マイナンバー（画面側）', () => {
  it('チェックデジット・入力の確かめ（作り物の番号で）', () => {
    expect(isValidMyNumber('111111111118')).toBeTrue();
    expect(myNumberProblem('')).toBeNull();
    expect(myNumberProblem('1111-1111-1118')).toBeNull();
    expect(myNumberProblem('12345')).toBe('digits');
    expect(myNumberProblem('111111111119')).toBe('checkDigit');
    expect(normalizeMyNumber('１１１１ １１１１ １１１８')).toBe('111111111118');
    expect(formatMyNumber('111111111118')).toBe('1111 1111 1118');
  });

  it('状態ごとの操作', () => {
    expect(adminActions(null)).toEqual(['set', 'request', 'refuse']);
    expect(adminActions('submitted')).toContain('approve');
    expect(adminActions('registered')).toEqual(['set', 'dispose']);
  });

  it('廃棄：喪失から2年たったら', () => {
    expect(disposalDue(person(), reg, '2026-03-31')).toBeNull();
    expect(disposalDue(person(), reg, '2026-04-01')).toBe('2026-04-01');
    // 番号がない・在籍中は出さない
    expect(disposalDue(person(), { ...reg, status: 'refused' }, '2027-01-01')).toBeNull();
    expect(disposalDue(person({ retireDate: null }), reg, '2030-01-01')).toBeNull();
  });

  it('喪失日：遅いほう／加入中なら null／未加入なら退職日の翌日', () => {
    expect(lossDateOf(person({ pension: { enrolled: true, lostDate: '2024-05-01' } }))).toBe('2024-05-01');
    expect(lossDateOf(person({ health: { enrolled: true, lostDate: null } }))).toBeNull();
    expect(
      lossDateOf(person({ health: { enrolled: false, lostDate: null }, pension: { enrolled: false, lostDate: null } })),
    ).toBe('2024-04-01');
  });
});
