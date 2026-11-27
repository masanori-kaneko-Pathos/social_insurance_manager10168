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

// ===== 保存期間を過ぎた退職者の削除（11/27。台帳 R110〜R113。画面の retention.ts と同じ決まり） =====
// 5年（労働基準法109条の本則）。数え始めるのは、退職日・最後の給与の支払月の末日・最後の賞与の支払日のうち遅い日
// （労働基準法施行規則56条）。5年たった次の日から消せる。サーバーでも数え直す（画面の判定だけを信じない）

export const RETENTION_YEARS = 5;

function daysIn(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 保存期間が終わって消せるようになる日（退職していなければ null） */
export function retentionDeletableOn(retireDate: string | null, lastPaidMonth: string | null, lastBonusDate: string | null): string | null {
  if (!retireDate) return null;
  const monthEnd = lastPaidMonth
    ? `${lastPaidMonth}-${String(daysIn(Number(lastPaidMonth.slice(0, 4)), Number(lastPaidMonth.slice(5, 7)))).padStart(2, '0')}`
    : null;
  const dates = [retireDate, monthEnd, lastBonusDate].filter((d): d is string => !!d).sort();
  const base = dates[dates.length - 1];
  const y = Number(base.slice(0, 4)) + RETENTION_YEARS;
  const m = Number(base.slice(5, 7));
  const d = Math.min(Number(base.slice(8, 10)), daysIn(y, m));
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

export type RetentionDeleteProblem =
  | 'notAdmin'
  | 'notFound'
  | 'numberMismatch'
  | 'notRetired' // 退職日がない
  | 'notYet' // 保存期間が終わっていない
  | 'hasMyNumber'; // マイナンバーが残っている（先に廃棄の手順を通す）

export interface RetentionDeleteFacts {
  isAdmin: boolean;
  exists: boolean;
  confirm: string;
  expected: string;
  retireDate: string | null;
  deletableOn: string | null;
  /** 今日（日本時間の YYYY-MM-DD） */
  today: string;
  hasMyNumber: boolean;
}

/** 保存期間を過ぎた退職者を消してよいか（届出の記録・マイページのアカウントは止めない。記録から外し、アカウントも消す） */
export function retentionDeleteProblem(f: RetentionDeleteFacts): RetentionDeleteProblem | null {
  if (!f.isAdmin) return 'notAdmin';
  if (!f.exists) return 'notFound';
  if (f.confirm.trim() === '' || f.confirm.trim() !== f.expected.trim()) return 'numberMismatch';
  if (!f.retireDate || !f.deletableOn) return 'notRetired';
  if (f.today < f.deletableOn) return 'notYet';
  if (f.hasMyNumber) return 'hasMyNumber';
  return null;
}

/** To-do の「確認した」の鍵のうち、その人のもの（鍵は「種類:従業員ID:日付」の形。todo-board.ts の todoKey・ageKey） */
export function dismissalOf(key: string, employeeId: string): boolean {
  return key.split(':')[1] === employeeId;
}
