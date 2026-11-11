// 事業所のメンバー（管理者・一般）の権限の決まり。関数（index.ts）が使う純粋な関数
// 画面には、関数がこの決まりで出した「この人にできる操作」をそのまま返す（画面で同じ決まりを二重に書かない）
//
// 決まり（11/11 に決めた）
// - 権限は管理者・一般の2つ。管理者の中の1人が「代表」（事業所を作った人。交代できる）
// - 一般：見るだけ。メンバーの操作はできない
// - 管理者：招待・一般を管理者に上げる・一般を外す。自分は（代表でなければ）一般に下りる・抜けることができる
// - 代表：管理者のできることに加えて、ほかの管理者を一般にする・外す・代表を交代する
//   （管理者どうしで下げ合えると、悪い管理者が見張り役の管理者を外せてしまうため。代表だけが止め役になる）
// - 代表はだれからも下げられず、外されない。代表が辞めるときは、先にほかの管理者に交代する
//   → 代表はいつも管理者なので、「管理者が1人もいない事業所」はできない

export type MemberRole = 'admin' | 'general';
export type MemberAction = 'promote' | 'demote' | 'remove' | 'transfer';

export interface Roster {
  roles: Readonly<Record<string, MemberRole>>;
  owner: string;
}

/** 断る理由（画面で翻訳する：members.error.〇〇） */
export type DenyReason = 'notMember' | 'notAdmin' | 'notOwner' | 'targetNotMember' | 'ownerLocked' | 'noChange';

/** 代表：ownerUid があればその人、なければ名簿の最初の人（古い事業所。作った人が最初に入っている） */
export function ownerOf(office: { ownerUid?: string | null; memberUids: readonly string[] }): string {
  return office.ownerUid && office.memberUids.includes(office.ownerUid) ? office.ownerUid : (office.memberUids[0] ?? '');
}

/** caller が target に action をしてよいか。よければ null、だめなら理由 */
export function denyReason(r: Roster, caller: string, target: string, action: MemberAction): DenyReason | null {
  const me = r.roles[caller];
  const them = r.roles[target];
  if (!me) return 'notMember';
  if (!them) return 'targetNotMember';
  const self = caller === target;
  const isOwner = caller === r.owner;

  // 代表を動かせるのは、代表が自分で交代するときだけ
  if (target === r.owner && action !== 'transfer') return 'ownerLocked';

  switch (action) {
    case 'promote':
      if (me !== 'admin') return 'notAdmin';
      return them === 'admin' ? 'noChange' : null;
    case 'demote':
      if (them !== 'admin') return 'noChange';
      if (self) return null; // 代表でない管理者は、自分で一般に下りられる（代表は上で止めた）
      return isOwner ? null : 'notOwner';
    case 'remove':
      if (self) return null; // 自分で抜ける（代表は上で止めた）
      if (me !== 'admin') return 'notAdmin';
      if (them === 'admin' && !isOwner) return 'notOwner';
      return null;
    case 'transfer':
      if (!isOwner) return 'notOwner';
      if (self) return 'noChange';
      return them === 'admin' ? null : 'notAdmin'; // 代表は管理者の中から選ぶ（先に管理者に上げる）
  }
}

/** caller が target にできる操作の一覧（画面のボタン用） */
export function actionsFor(r: Roster, caller: string, target: string): MemberAction[] {
  const all: MemberAction[] = ['promote', 'demote', 'transfer', 'remove'];
  return all.filter((a) => denyReason(r, caller, target, a) === null);
}

/** 操作したあとの名簿（関数は、この結果を書き込む） */
export function applyAction(
  r: Roster,
  target: string,
  action: MemberAction,
): { roles: Record<string, MemberRole>; owner: string } {
  const roles = { ...r.roles };
  let owner = r.owner;
  if (action === 'promote') roles[target] = 'admin';
  if (action === 'demote') roles[target] = 'general';
  if (action === 'remove') delete roles[target];
  if (action === 'transfer') owner = target;
  return { roles, owner };
}

/** 招待で決めたアドレスと、ログインしている人のアドレスが同じか（大文字小文字・前後の空白は無視） */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** 招待を使えない理由（使えれば null）。画面で翻訳する：invite.error.〇〇 */
export type InviteProblem = 'notFound' | 'kind' | 'used' | 'expired' | 'email' | 'unverified' | 'employeeAccount' | 'alreadyMember';

export function memberInviteProblem(
  invite: { kind: string; role: string | null; email: string | null; usedBy: string | null; expiresMs: number } | null,
  user: { email: string | null; emailVerified: boolean; appRole: string | null; isMember: boolean },
  nowMs: number,
): InviteProblem | null {
  if (!invite) return 'notFound';
  if (invite.kind !== 'member' || (invite.role !== 'admin' && invite.role !== 'general')) return 'kind';
  if (invite.usedBy) return 'used';
  if (invite.expiresMs <= nowMs) return 'expired';
  if (!sameEmail(invite.email, user.email)) return 'email';
  if (!user.emailVerified) return 'unverified';
  if (user.appRole === 'employee') return 'employeeAccount';
  if (user.isMember) return 'alreadyMember';
  return null;
}
