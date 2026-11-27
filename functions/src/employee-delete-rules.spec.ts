import {
  dismissalOf,
  employeeDeleteProblem,
  filingAfterRemove,
  myNumberRecorded,
  retentionDeletableOn,
  retentionDeleteProblem,
  withoutEmployee,
} from './employee-delete-rules';

const ok = {
  isAdmin: true,
  exists: true,
  employeeNumber: 'E201',
  confirm: 'E201',
  expected: 'E201',
  filingCount: 0,
  hasMyNumber: false,
  hasAccount: false,
};

describe('employeeDeleteProblem：登録の取り消し', () => {
  it('管理者が、社員番号を打ち込めば消せる', () => {
    expect(employeeDeleteProblem(ok)).toBeNull();
  });
  it('管理者でない・いない人', () => {
    expect(employeeDeleteProblem({ ...ok, isAdmin: false })).toBe('notAdmin');
    expect(employeeDeleteProblem({ ...ok, exists: false })).toBe('notFound');
  });
  it('打ち込んだ番号が違う・空', () => {
    expect(employeeDeleteProblem({ ...ok, confirm: 'E200' })).toBe('numberMismatch');
    expect(employeeDeleteProblem({ ...ok, confirm: ' ' })).toBe('numberMismatch');
  });
  it('外に出た記録があれば消さない（届出 → マイナンバー → アカウントの順に知らせる）', () => {
    expect(employeeDeleteProblem({ ...ok, filingCount: 1, hasMyNumber: true })).toBe('hasFilings');
    expect(employeeDeleteProblem({ ...ok, hasMyNumber: true })).toBe('hasMyNumber');
    expect(employeeDeleteProblem({ ...ok, hasAccount: true })).toBe('hasAccount');
  });
});

describe('myNumberRecorded', () => {
  it('本人か家族の記録があれば true', () => {
    expect(myNumberRecorded(undefined, 'e1')).toBeFalse();
    expect(myNumberRecorded({ people: { e2: { status: 'registered' } } }, 'e1')).toBeFalse();
    expect(myNumberRecorded({ people: { e1: { status: 'requested' } } }, 'e1')).toBeTrue();
    expect(myNumberRecorded({ family: { e1: { d1: { status: 'registered' } } } }, 'e1')).toBeTrue();
    expect(myNumberRecorded({ family: { e1: { d1: null } } }, 'e1')).toBeFalse();
  });
});

describe('withoutEmployee：賞与の額から外す', () => {
  it('その人だけ外す。入っていなければ null', () => {
    expect(withoutEmployee({ e1: 100, e2: 200 }, 'e1')).toEqual({ e2: 200 });
    expect(withoutEmployee({ e2: 200 }, 'e1')).toBeNull();
    expect(withoutEmployee(undefined, 'e1')).toBeNull();
  });
});

describe('filingAfterRemove：届出の記録', () => {
  it('提出日があれば出した届。対象者からその人を外す', () => {
    expect(filingAfterRemove({ submittedOn: '2026-11-01', employeeIds: ['e1', 'e2'] }, 'e1')).toEqual({ submitted: true, rest: ['e2'] });
    expect(filingAfterRemove({ submittedOn: null, employeeIds: ['e1'] }, 'e1')).toEqual({ submitted: false, rest: [] });
  });
});

describe('保存期間を過ぎた退職者の削除（11/27）', () => {
  it('消せる日：退職日・最後の給与の月末・最後の賞与のうち遅い日から5年の次の日（画面の retention.ts と同じ）', () => {
    expect(retentionDeletableOn('2021-03-31', '2021-04', null)).toBe('2026-05-01');
    expect(retentionDeletableOn('2021-06-30', '2021-06', '2021-07-10')).toBe('2026-07-11');
    expect(retentionDeletableOn('2024-02-29', null, null)).toBe('2029-03-01');
    expect(retentionDeletableOn(null, '2021-04', null)).toBeNull();
  });

  const ok = {
    isAdmin: true,
    exists: true,
    confirm: 'E201',
    expected: 'E201',
    retireDate: '2021-03-31',
    deletableOn: '2026-05-01',
    today: '2026-11-27',
    hasMyNumber: false,
  };
  it('保存期間が終わっていれば消せる。届出の記録・アカウントでは止めない', () => {
    expect(retentionDeleteProblem(ok)).toBeNull();
  });
  it('止める理由：管理者でない・番号違い・退職していない・期間内・マイナンバーが残っている', () => {
    expect(retentionDeleteProblem({ ...ok, isAdmin: false })).toBe('notAdmin');
    expect(retentionDeleteProblem({ ...ok, confirm: 'E202' })).toBe('numberMismatch');
    expect(retentionDeleteProblem({ ...ok, retireDate: null, deletableOn: null })).toBe('notRetired');
    expect(retentionDeleteProblem({ ...ok, today: '2026-04-30' })).toBe('notYet');
    expect(retentionDeleteProblem({ ...ok, hasMyNumber: true })).toBe('hasMyNumber');
  });
  it('To-do の「確認した」の鍵から、その人のものを見分ける', () => {
    expect(dismissalOf('retireGuide:E1:2021-03-31', 'E1')).toBeTrue();
    expect(dismissalOf('age:E1:40', 'E1')).toBeTrue();
    expect(dismissalOf('retireGuide:E10:2021-03-31', 'E1')).toBeFalse();
    expect(dismissalOf('task:abc', 'E1')).toBeFalse();
  });
});
