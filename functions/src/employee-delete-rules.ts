// 従業員の「登録の取り消し」の決まり（11/17。純粋な関数。spec あり）
// 間違えて登録した人（二重登録など）を消すためのもの。退職は退職日で表すので、これは使わない
// 外に出た記録がある人は消さない（年金事務所に出した届・マイナンバー・本人のアカウント）

export type EmployeeDeleteProblem =
  | 'notAdmin'
  | 'notFound'
  | 'numberMismatch' // 打ち込んだ社員番号が違う
  | 'hasFilings' // 提出日のある届出の記録に入っている（年金事務所での取消の手続きが要る）
  | 'hasMyNumber' // マイナンバーの記録がある（先に廃棄・依頼の取り消し）
  | 'hasAccount'; // マイページのアカウントがつながっている

export interface EmployeeDeleteFacts {
  isAdmin: boolean;
  exists: boolean;
  /** 登録されている社員番号（なければ空） */
  employeeNumber: string;
  /** 画面で打ち込んだ確認の文字（社員番号。番号がない人は姓） */
  confirm: string;
  /** 確認に使う文字（社員番号。番号がない人は姓） */
  expected: string;
  /** 提出日のある届出の記録の数（まだ出していない記録は数えない。消すときにその人を外す） */
  filingCount: number;
  hasMyNumber: boolean;
  hasAccount: boolean;
}

export function employeeDeleteProblem(f: EmployeeDeleteFacts): EmployeeDeleteProblem | null {
  if (!f.isAdmin) return 'notAdmin';
  if (!f.exists) return 'notFound';
  if (f.confirm.trim() === '' || f.confirm.trim() !== f.expected.trim()) return 'numberMismatch';
  if (f.filingCount > 0) return 'hasFilings';
  if (f.hasMyNumber) return 'hasMyNumber';
  if (f.hasAccount) return 'hasAccount';
  return null;
}

/** マイナンバーの一覧（myNumberIndex/all）に、その人か家族の記録があるか */
export function myNumberRecorded(
  index: { people?: Record<string, unknown>; family?: Record<string, Record<string, unknown>> } | undefined,
  employeeId: string,
): boolean {
  if (!index) return false;
  if (index.people?.[employeeId]) return true;
  const fam = index.family?.[employeeId];
  return !!fam && Object.values(fam).some((v) => !!v);
}

/** 届出の記録：提出日があるか（出した届）／その人を外したあとの対象者（空なら記録ごと消す） */
export function filingAfterRemove(
  f: { submittedOn?: string | null; employeeIds?: readonly string[] },
  employeeId: string,
): { submitted: boolean; rest: string[] } {
  return { submitted: !!f.submittedOn, rest: (f.employeeIds ?? []).filter((id) => id !== employeeId) };
}

/** 賞与の支給の額から、その人を外す（ほかの人はそのまま）。変わらなければ null */
export function withoutEmployee(
  amounts: Record<string, number> | undefined,
  employeeId: string,
): Record<string, number> | null {
  if (!amounts || !(employeeId in amounts)) return null;
  const out = { ...amounts };
  delete out[employeeId];
  return out;
}
