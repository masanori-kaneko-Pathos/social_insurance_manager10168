// 役員の社会保険の加入の候補（最後に決めるのは人。日本年金機構の判断材料の整理）
// Angular・Firebase に依存しない純粋な関数
//
// 根拠（11/12 に本人が確認）
// - 法人の役員は、法人から労務の対償として報酬を受けていれば被保険者（報酬がなければ被保険者になれない）
// - 判断は「経営に参画する経常的な労務の提供か」「報酬がその対価として経常的に払われるか」を実態で総合的に
// - 非常勤は6項目（定期出勤・他職兼務・役員会出席・連絡調整や指揮監督・意見を述べる立場・報酬の水準）に優先順位なく、
//   多くが加入の方向なら加入、多くが除外の方向なら対象外
// - 2026-03-18 の厚労省の通知：役員報酬を上回る会費などを払わせている個人事業主の役員は、原則として対象外

import { OFFICER_CHECKS, OfficerInfo } from '../../../core/models/employee';

export type OfficerCandidate =
  | 'enroll' // 加入の候補
  | 'exclude' // 対象外の候補
  | 'unclear' // 半々・答えが足りない（人が判断）
  | 'noPay'; // 報酬がない → 被保険者になれない

export interface OfficerJudgement {
  candidate: OfficerCandidate;
  /** 加入の方向・除外の方向・まだの数（非常勤のときだけ意味がある） */
  toward: number;
  away: number;
  unanswered: number;
}

/**
 * @param monthlyPay 役員報酬（月額。契約の所定内賃金など。わからなければ null）
 */
export function judgeOfficer(o: OfficerInfo, monthlyPay: number | null): OfficerJudgement {
  const values = OFFICER_CHECKS.map((k) => o.checks[k]);
  const toward = values.filter((v) => v === true).length;
  const away = values.filter((v) => v === false).length;
  const unanswered = values.filter((v) => v === null).length;
  const base = { toward, away, unanswered };
  if (monthlyPay === 0) return { ...base, candidate: 'noPay' };
  if (o.type !== 'partTime') return { ...base, candidate: 'enroll' };
  // 非常勤：答えた中で多いほう。過半（4つ以上）に届かなければ人の判断
  if (toward >= 4) return { ...base, candidate: 'enroll' };
  if (away >= 4) return { ...base, candidate: 'exclude' };
  return { ...base, candidate: 'unclear' };
}

export function emptyOfficerChecks(): OfficerInfo['checks'] {
  return { attendance: null, fewOtherJobs: null, boardMeetings: null, supervision: null, beyondAdvice: null, fairPay: null };
}
