// 資格取得日・資格喪失日の注意（11/26。保存はできる）
// Angular・Firebase に依存しない純粋な関数
//
// ふつうは 資格取得日 ＝ 入社日、資格喪失日 ＝ 退職日の翌日。違うときに知らせる。
// ただし、正しく違う場合がある（エラーにしない）
// - 取得日：入社のあと、所定労働時間が増えるなどして加入の条件を満たした（短時間で働いていた人など）
// - 喪失日：退職より前に、70歳（厚生年金）・75歳（健康保険）になった、加入の条件を満たさなくなった
// 喪失日だけで退職日がないとき（年齢・区分の変化で抜けた）は比べない。

import { addDays } from '../../../shared/utils/date';

export type EnrollmentNote = 'acquiredNotHire' | 'lostNotRetireNext';

export interface EnrollmentDates {
  enrolled: boolean;
  acquiredDate: string;
  lostDate: string;
}

export function enrollmentNotes(hireDate: string, retireDate: string, e: EnrollmentDates): EnrollmentNote[] {
  const out: EnrollmentNote[] = [];
  if (e.enrolled && hireDate && e.acquiredDate && e.acquiredDate !== hireDate) out.push('acquiredNotHire');
  if (retireDate && e.lostDate && e.lostDate !== addDays(retireDate, 1)) out.push('lostNotRetireNext');
  return out;
}
