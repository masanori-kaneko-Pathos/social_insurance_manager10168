// 項目どうしの整合チェック（11/28。棚卸し memo/consistency-checks-1128.md の「抜けている所」1〜3）
// どれも「知らせる」だけ（保存・取り込みは止めない）。例外がありうるため

/** 子・孫の続柄（被保険者より年下のはず） */
const YOUNGER_RELATIONSHIPS: readonly string[] = ['child', 'otherChild', 'grandchild'];

/**
 * 1. 続柄が子・孫なのに、生年月日が被保険者と同じか前（続柄か生年月日の打ち間違いがほとんど。養子などの例外があるので止めない）
 */
export function childNotYounger(relationship: string, dependentBirth: string, insuredBirth: string | null | undefined): boolean {
  if (!YOUNGER_RELATIONSHIPS.includes(relationship)) return false;
  if (!dependentBirth || !insuredBirth) return false;
  return dependentBirth <= insuredBirth;
}

/**
 * 2. 標準報酬月額の開始月が、健康保険の資格取得月より前（取得より前の月の標準報酬は保険料に使われない。月の打ち間違いが多い）
 * fromMonth は 'YYYY-MM'、acquiredDate は 'YYYY-MM-DD'
 */
export function remunerationBeforeAcquired(fromMonth: string, acquiredDate: string | null | undefined): boolean {
  if (!fromMonth || !acquiredDate) return false;
  return fromMonth < acquiredDate.slice(0, 7);
}

/**
 * 3. 被扶養者になった日が、被保険者の健康保険の資格取得日より前（被扶養者は資格取得日より前にはなれない）
 * 入社日より前（beforeHire）は前からある知らせなので、入社日以後で取得日より前のときだけ true
 */
export function dependentBeforeAcquired(from: string, hireDate: string | null | undefined, acquiredDate: string | null | undefined): boolean {
  if (!from || !acquiredDate) return false;
  if (hireDate && from < hireDate) return false;
  return from < acquiredDate;
}
