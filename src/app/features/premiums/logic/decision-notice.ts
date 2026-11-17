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
  return { title: `標準報酬月額の決定のお知らせ（${y}年${m}月分から）`, body: lines.join('\n') };
}
