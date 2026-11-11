import { actionsFor, applyAction, deleteProblem, denyReason, memberInviteProblem, ownerOf, Roster } from './member-rules';

// O：代表（管理者）、A・B：管理者、G・H：一般
const R: Roster = { roles: { O: 'admin', A: 'admin', B: 'admin', G: 'general', H: 'general' }, owner: 'O' };

describe('メンバーの権限：代表', () => {
  it('古い事業所は名簿の最初の人が代表', () => {
    expect(ownerOf({ memberUids: ['x', 'y'] })).toBe('x');
    expect(ownerOf({ ownerUid: 'y', memberUids: ['x', 'y'] })).toBe('y');
    expect(ownerOf({ ownerUid: 'gone', memberUids: ['x', 'y'] })).toBe('x'); // 外された人なら最初の人
  });

  it('代表は、ほかの管理者を一般にできる・外せる・交代できる', () => {
    expect(denyReason(R, 'O', 'A', 'demote')).toBeNull();
    expect(denyReason(R, 'O', 'A', 'remove')).toBeNull();
    expect(denyReason(R, 'O', 'A', 'transfer')).toBeNull();
  });

  it('代表はだれからも下げられず、外されない。自分でも（交代が先）', () => {
    expect(denyReason(R, 'A', 'O', 'demote')).toBe('ownerLocked');
    expect(denyReason(R, 'A', 'O', 'remove')).toBe('ownerLocked');
    expect(denyReason(R, 'O', 'O', 'demote')).toBe('ownerLocked');
    expect(denyReason(R, 'O', 'O', 'remove')).toBe('ownerLocked');
  });

  it('代表の交代は、管理者の中から（一般は先に管理者に上げる）', () => {
    expect(denyReason(R, 'O', 'G', 'transfer')).toBe('notAdmin');
    expect(denyReason(R, 'A', 'B', 'transfer')).toBe('notOwner');
  });
});

describe('メンバーの権限：管理者・一般', () => {
  it('管理者は、一般を管理者に上げる・外す', () => {
    expect(denyReason(R, 'A', 'G', 'promote')).toBeNull();
    expect(denyReason(R, 'A', 'G', 'remove')).toBeNull();
  });

  it('管理者は、ほかの管理者を一般にできない・外せない（見張り役を守る）', () => {
    expect(denyReason(R, 'A', 'B', 'demote')).toBe('notOwner');
    expect(denyReason(R, 'A', 'B', 'remove')).toBe('notOwner');
  });

  it('代表でない管理者は、自分で一般に下りる・抜けることができる', () => {
    expect(denyReason(R, 'A', 'A', 'demote')).toBeNull();
    expect(denyReason(R, 'A', 'A', 'remove')).toBeNull();
  });

  it('一般は、ほかの人に何もできない（自分で抜けることだけできる）', () => {
    expect(denyReason(R, 'G', 'H', 'promote')).toBe('notAdmin');
    expect(denyReason(R, 'G', 'H', 'remove')).toBe('notAdmin');
    expect(denyReason(R, 'G', 'A', 'demote')).toBe('notOwner');
    expect(denyReason(R, 'G', 'G', 'promote')).toBe('notAdmin');
  });

  it('名簿にない人', () => {
    expect(denyReason(R, 'X', 'G', 'remove')).toBe('notMember');
    expect(denyReason(R, 'A', 'X', 'remove')).toBe('targetNotMember');
  });

  it('画面のボタンの一覧', () => {
    expect(actionsFor(R, 'O', 'A')).toEqual(['demote', 'transfer', 'remove']);
    expect(actionsFor(R, 'O', 'G')).toEqual(['promote', 'remove']);
    expect(actionsFor(R, 'A', 'B')).toEqual([]);
    expect(actionsFor(R, 'A', 'G')).toEqual(['promote', 'remove']);
    expect(actionsFor(R, 'A', 'A')).toEqual(['demote', 'remove']);
    expect(actionsFor(R, 'A', 'O')).toEqual([]);
    expect(actionsFor(R, 'O', 'O')).toEqual([]);
  });

  it('どの操作のあとも、代表は管理者のまま（管理者が0人にならない）', () => {
    for (const caller of Object.keys(R.roles)) {
      for (const target of Object.keys(R.roles)) {
        for (const a of actionsFor(R, caller, target)) {
          const after = applyAction(R, target, a);
          expect(after.roles[after.owner]).toBe('admin');
        }
      }
    }
  });

  it('操作のあとの名簿', () => {
    expect(applyAction(R, 'G', 'promote').roles['G']).toBe('admin');
    expect(applyAction(R, 'A', 'demote').roles['A']).toBe('general');
    expect('G' in applyAction(R, 'G', 'remove').roles).toBeFalse();
    expect(applyAction(R, 'A', 'transfer').owner).toBe('A');
  });
});

describe('メンバーの招待を使えるか', () => {
  const now = 1_000_000;
  const inv = { kind: 'member', role: 'general', email: 'Yamada@Example.com', usedBy: null, expiresMs: now + 1 };
  const user = { email: 'yamada@example.com', emailVerified: true, appRole: null, isMember: false };

  it('使える（アドレスの大文字小文字は無視）', () => {
    expect(memberInviteProblem(inv, user, now)).toBeNull();
  });

  it('使えない理由', () => {
    expect(memberInviteProblem(null, user, now)).toBe('notFound');
    expect(memberInviteProblem({ ...inv, kind: 'employee' }, user, now)).toBe('kind');
    expect(memberInviteProblem({ ...inv, usedBy: 'x' }, user, now)).toBe('used');
    expect(memberInviteProblem({ ...inv, expiresMs: now }, user, now)).toBe('expired');
    expect(memberInviteProblem(inv, { ...user, email: 'other@example.com' }, now)).toBe('email');
    expect(memberInviteProblem({ ...inv, email: null }, user, now)).toBe('email'); // アドレスのない招待は使えない
    expect(memberInviteProblem(inv, { ...user, emailVerified: false }, now)).toBe('unverified');
    expect(memberInviteProblem(inv, { ...user, appRole: 'employee' }, now)).toBe('employeeAccount');
    expect(memberInviteProblem(inv, { ...user, isMember: true }, now)).toBe('alreadyMember');
  });
});

describe('アカウントを消してよいか（本人だけ）', () => {
  const office = (owner: string, members: string[]) => ({ ownerUid: owner, memberUids: members });

  it('代表でない管理者・一般は消せる。どこにも入っていない人も消せる', () => {
    expect(deleteProblem('G', 'general', [office('O', ['O', 'G'])])).toBeNull();
    expect(deleteProblem('A', 'admin', [office('O', ['O', 'A'])])).toBeNull();
    expect(deleteProblem('X', 'admin', [])).toBeNull();
  });

  it('どこか1つでも代表なら消せない（1人だけの事業所も）', () => {
    expect(deleteProblem('O', 'admin', [office('X', ['X', 'O']), office('O', ['O'])])).toBe('owner');
    // ownerUid がない古い事業所は、名簿の最初の人が代表
    expect(deleteProblem('O', 'admin', [{ memberUids: ['O', 'G'] }])).toBe('owner');
  });

  it('従業員のアカウントは消せない', () => {
    expect(deleteProblem('E', 'employee', [])).toBe('employee');
  });
});
