// 標準報酬月額の決定通知を、従業員のマイページに届ける（B12・カタログ【5】決定通知。11/17）
// 年金事務所から「標準報酬決定（改定）通知書」が届いたら、事業主は本人に知らせる（健康保険法・厚生年金保険法）
// 受信箱の文書の決まり（title・body・link）は変えず、link に決定の中身を入れる。
// マイページは link を読んで、本人の言語で文を組み立てる（title・body は日本語の控え）
// Angular・Firebase に依存しない純粋な関数

import type { RemunerationReason } from '../../../core/models/remuneration';

export interface DecisionNotice {
  from: string; // 'YYYY-MM'（何月分から）
  reason: RemunerationReason;
  health: { grade: number; standard: number } | null;
  /** 厚生年金に入っていない月（70歳以上など）は null */
  pension: { grade: number; standard: number } | null;
}

const PREFIX = 'decision';
const REASONS: readonly RemunerationReason[] = ['acquisition', 'regular', 'irregular', 'other', 'leaveEnd', 'special'];

/** 'decision|2026-09|regular|22|300000|19|300000'（入っていない保険は '-'） */
export function encodeDecision(d: DecisionNotice): string {
  const part = (x: DecisionNotice['health']) => (x ? `${x.grade}|${x.standard}` : '-|-');
  return [PREFIX, d.from, d.reason, part(d.health), part(d.pension)].join('|');
}

export function parseDecision(link: string | null | undefined): DecisionNotice | null {
  if (!link || !link.startsWith(`${PREFIX}|`)) return null;
  const [, from, reason, hg, hs, pg, ps] = link.split('|');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from ?? '') || !REASONS.includes(reason as RemunerationReason)) return null;
  const part = (g?: string, s?: string) => {
    if (g === '-' || g === undefined) return null;
    const grade = Number(g);
    const standard = Number(s);
    return Number.isInteger(grade) && Number.isInteger(standard) ? { grade, standard } : null;
  };
  return { from, reason: reason as RemunerationReason, health: part(hg, hs), pension: part(pg, ps) };
}

/** その月の通知を探すための link の範囲（同じ月に送ったかを確かめる） */
export function decisionLinkRange(month: string): { start: string; end: string } {
  return { start: `${PREFIX}|${month}|`, end: `${PREFIX}|${month}|~` };
}

const REASON_JA: Record<RemunerationReason, string> = {
  acquisition: '資格取得時決定',
  regular: '定時決定',
  irregular: '随時改定',
  other: 'その他',
  leaveEnd: '休業終了時改定',
  special: '特例改定',
};

/** 日本語の控え（受信箱の title・body。マイページは link から本人の言語で出す） */
export function decisionTextJa(d: DecisionNotice): { title: string; body: string } {
  const [y, m] = d.from.split('-').map(Number);
  const yen = (n: number) => n.toLocaleString('ja-JP');
  const lines = [`${y}年${m}月分から、標準報酬月額が決まりました（${REASON_JA[d.reason]}）。`];
  if (d.health) lines.push(`健康保険：${d.health.grade}級 ${yen(d.health.standard)}円`);
  if (d.pension) lines.push(`厚生年金：${d.pension.grade}級 ${yen(d.pension.standard)}円`);
  lines.push('毎月の保険料の内訳は、マイページの保険料で確かめられます。');
  lines.push(APPEAL_JA);
  return { title: `標準報酬月額の決定のお知らせ（${y}年${m}月分から）`, body: lines.join('\n') };
}

// ===== 標準賞与額・資格の取得と喪失（11/19） =====
// 健康保険法49条2項・厚生年金保険法29条2項：事業主は、資格の取得・喪失の確認と、標準報酬（標準報酬月額・標準賞与額）の
// 決定・改定の通知を受けたら、速やかに被保険者（だった人）に知らせる。日本年金機構の通知書の様式（被保険者用）の5つの欄に合わせる

/** 賞与支払時の決定：健保・厚年の標準賞与額（上限を当てたあと。入っていない保険は null）と、本人負担の保険料 */
export interface BonusDecisionNotice {
  paidDate: string; // 'YYYY-MM-DD'
  health: number | null;
  pension: number | null;
  employeeYen: number;
}

/** 資格の取得・喪失（入っている保険だけ） */
export interface QualificationNotice {
  event: 'acquire' | 'loss';
  date: string; // 取得日・喪失日
  health: boolean;
  pension: boolean;
}

const BONUS_PREFIX = 'bonus';
const QUAL_PREFIX = 'qual';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (s: string | undefined) => (s === '-' || s === undefined ? null : Number.isInteger(Number(s)) ? Number(s) : null);

/** 'bonus|2026-12-10|300000|300000|44820'（入っていない保険は '-'） */
export function encodeBonusDecision(d: BonusDecisionNotice): string {
  const v = (n: number | null) => (n === null ? '-' : String(n));
  return [BONUS_PREFIX, d.paidDate, v(d.health), v(d.pension), String(d.employeeYen)].join('|');
}

export function parseBonusDecision(link: string | null | undefined): BonusDecisionNotice | null {
  if (!link || !link.startsWith(`${BONUS_PREFIX}|`)) return null;
  const [, paidDate, h, p, yen] = link.split('|');
  if (!DATE.test(paidDate ?? '') || num(yen) === null) return null;
  return { paidDate, health: num(h), pension: num(p), employeeYen: num(yen)! };
}

/** 'qual|2026-10-01|acquire|HP'（H：健康保険、P：厚生年金） */
export function encodeQualification(d: QualificationNotice): string {
  return [QUAL_PREFIX, d.date, d.event, `${d.health ? 'H' : ''}${d.pension ? 'P' : ''}`].join('|');
}

export function parseQualification(link: string | null | undefined): QualificationNotice | null {
  if (!link || !link.startsWith(`${QUAL_PREFIX}|`)) return null;
  const [, date, event, ins] = link.split('|');
  if (!DATE.test(date ?? '') || (event !== 'acquire' && event !== 'loss')) return null;
  return { event, date, health: (ins ?? '').includes('H'), pension: (ins ?? '').includes('P') };
}

/** その月の通知の link の範囲（kind ごと。月の通知はすでに decisionLinkRange） */
export function noticeLinkRange(kind: 'bonus' | 'qual', month: string): { start: string; end: string } {
  const prefix = kind === 'bonus' ? BONUS_PREFIX : QUAL_PREFIX;
  return { start: `${prefix}|${month}`, end: `${prefix}|${month}~` };
}

const ymd = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return `${y}年${m}月${day}日`;
};

/** 審査請求の教示（年金機構の通知書の様式と同じ文） */
export const APPEAL_JA =
  'この決定に不服があるときは、決定があったことを知った日の翌日から3か月以内に、文書または口頭で社会保険審査官（地方厚生（支）局内）に審査請求できます。';

export function bonusDecisionTextJa(d: BonusDecisionNotice): { title: string; body: string } {
  const yen = (n: number) => n.toLocaleString('ja-JP');
  const lines = [`${ymd(d.paidDate)}に支払った賞与の標準賞与額が決まりました（賞与支払時の決定）。`];
  if (d.health !== null) lines.push(`健康保険：${yen(d.health)}円`);
  if (d.pension !== null) lines.push(`厚生年金：${yen(d.pension)}円`);
  lines.push(`この賞与の保険料（本人負担）：${yen(d.employeeYen)}円`, APPEAL_JA);
  return { title: `標準賞与額の決定のお知らせ（${ymd(d.paidDate)}支払）`, body: lines.join('\n') };
}

export function qualificationTextJa(d: QualificationNotice): { title: string; body: string } {
  const ins = [d.health && '健康保険', d.pension && '厚生年金保険'].filter(Boolean).join('・');
  const what = d.event === 'acquire' ? '資格取得' : '資格喪失';
  return {
    title: `${what}のお知らせ（${ymd(d.date)}）`,
    body: [`${ins}の被保険者の${what}が確認されました（${what}日：${ymd(d.date)}）。`, APPEAL_JA].join('\n'),
  };
}
