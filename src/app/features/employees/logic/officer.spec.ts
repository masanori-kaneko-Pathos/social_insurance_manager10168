import { emptyOfficerChecks, judgeOfficer } from './officer';

const checks = (yes: number, no: number) => {
  const c = emptyOfficerChecks();
  const keys = Object.keys(c) as (keyof typeof c)[];
  keys.forEach((k, i) => (c[k] = i < yes ? true : i < yes + no ? false : null));
  return c;
};

describe('judgeOfficer：役員の加入の候補', () => {
  it('代表者・常勤は加入の候補。報酬がなければ被保険者になれない', () => {
    expect(judgeOfficer({ type: 'representative', checks: emptyOfficerChecks() }, 300000).candidate).toBe('enroll');
    expect(judgeOfficer({ type: 'fullTime', checks: emptyOfficerChecks() }, 0).candidate).toBe('noPay');
  });
  it('非常勤は6項目のうち4つ以上で決める。半々・答えが足りなければ人の判断', () => {
    expect(judgeOfficer({ type: 'partTime', checks: checks(4, 2) }, 50000).candidate).toBe('enroll');
    expect(judgeOfficer({ type: 'partTime', checks: checks(0, 6) }, 50000).candidate).toBe('exclude');
    expect(judgeOfficer({ type: 'partTime', checks: checks(3, 3) }, 50000).candidate).toBe('unclear');
    const j = judgeOfficer({ type: 'partTime', checks: checks(2, 1) }, null);
    expect([j.candidate, j.toward, j.away, j.unanswered]).toEqual(['unclear', 2, 1, 3]);
  });
});
