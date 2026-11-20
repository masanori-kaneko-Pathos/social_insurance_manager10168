// 本人負担が前の月から変わった月と、その理由（1人分の年表。11/20）
// Angular・Firebase に依存しない純粋な関数
//
// 「なぜ今月から天引きが増えたのか」に答えるための並べ直し。計算はしない（月ごとの計算結果を前の月と見比べるだけ）。
// 理由は計算結果の違いから読み取る：
//   保険料がかかり始めた・かからなくなった／免除の始まり・終わり／標準報酬月額が変わった／
//   介護保険・厚生年金・健康保険・支援金が付いた・外れた／料率が変わった
import { PremiumLine, PremiumPart, PremiumResult } from '../../../core/models/premium';

/** 月ごとの計算結果（計算できなかった月は result が null） */
export interface ChangeSource {
  month: string;
  result: PremiumResult | null;
}

export type ChangeReason =
  | { kind: 'start' } // 保険料がかかり始めた（資格取得など）
  | { kind: 'end' } // 保険料がかからなくなった（資格喪失など）
  | { kind: 'exemptStart' } // 産休・育休の免除が始まった
  | { kind: 'exemptEnd' } // 免除が終わった
  | { kind: 'base'; part: 'health' | 'pension'; from: number; to: number; fromGrade: number | null; toGrade: number | null }
  | { kind: 'partStart'; part: PremiumPart } // その保険料が付いた（40歳の介護保険など）
  | { kind: 'partEnd'; part: PremiumPart } // その保険料が外れた（65歳の介護保険、70歳の厚生年金など）
  | { kind: 'rate'; part: PremiumPart; from: number; to: number }; // 料率の改定（本人分＋会社分の率）

export interface PremiumChange {
  month: string;
  /** 前の月の本人負担（免除・かからない月は 0） */
  before: number;
  after: number;
  reasons: ChangeReason[];
}

/** 本人が負担する保険料の種類（拠出金は会社だけなので年表に出さない） */
const PARTS: readonly PremiumPart[] = ['health', 'care', 'childSupport', 'pension'];

function linesOf(r: PremiumResult): Map<PremiumPart, PremiumLine> {
  const map = new Map<PremiumPart, PremiumLine>();
  for (const g of r.groups) for (const l of g.lines) map.set(l.part, l);
  return map;
}

/** 見比べられる月か（計算できなかった月・料率や標準報酬が足りない月は飛ばす） */
function comparable(r: PremiumResult | null): r is PremiumResult {
  return !!r && r.missing.length === 0;
}

const charged = (r: PremiumResult) => !r.exempt && r.groups.length > 0;
const rateOf = (l: PremiumLine) => l.rate.employee + l.rate.employer;

function reasonsBetween(prev: PremiumResult, cur: PremiumResult): ChangeReason[] {
  if (!!prev.exempt !== !!cur.exempt) return [{ kind: cur.exempt ? 'exemptStart' : 'exemptEnd' }];
  if (charged(prev) !== charged(cur)) return [{ kind: charged(cur) ? 'start' : 'end' }];
  if (!charged(cur)) return [];
  const a = linesOf(prev);
  const b = linesOf(cur);
  const reasons: ChangeReason[] = [];
  // 標準報酬月額（健保の額を先に。厚年だけ違うときは厚年も出す）
  for (const part of ['health', 'pension'] as const) {
    const x = a.get(part);
    const y = b.get(part);
    if (!x || !y || x.base === y.base) continue;
    const health = part === 'pension' ? reasons.find((r) => r.kind === 'base' && r.part === 'health') : undefined;
    // 健保と厚年が同じ額どうしで変わったら1行にまとめる
    if (health && health.kind === 'base' && health.from === x.base && health.to === y.base) continue;
    reasons.push({ kind: 'base', part, from: x.base, to: y.base, fromGrade: x.grade, toGrade: y.grade });
  }
  for (const part of PARTS) {
    const x = a.get(part);
    const y = b.get(part);
    if (!x && y) reasons.push({ kind: 'partStart', part });
    else if (x && !y) reasons.push({ kind: 'partEnd', part });
    else if (x && y && rateOf(x) !== rateOf(y)) reasons.push({ kind: 'rate', part, from: rateOf(x), to: rateOf(y) });
  }
  return reasons;
}

/**
 * 本人負担が前の月から変わった月（古い順）
 * - rows は月の順でなくてよい（中で並べる）
 * - 見比べられない月（計算できなかった月）をはさんだら、その前後は比べない
 * - 額が同じで理由もない月は出さない。額が同じでも免除の始まり・終わりは出す
 */
export function premiumChanges(rows: readonly ChangeSource[]): PremiumChange[] {
  const sorted = [...rows].sort((x, y) => x.month.localeCompare(y.month));
  const out: PremiumChange[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].result;
    const cur = sorted[i].result;
    if (!comparable(prev) || !comparable(cur)) continue;
    const before = prev.exempt ? 0 : prev.employeeYen;
    const after = cur.exempt ? 0 : cur.employeeYen;
    const reasons = reasonsBetween(prev, cur);
    const stateChanged = reasons.some((r) => r.kind === 'exemptStart' || r.kind === 'exemptEnd' || r.kind === 'start' || r.kind === 'end');
    if (before === after && !stateChanged) continue;
    out.push({ month: sorted[i].month, before, after, reasons });
  }
  return out;
}
