// 1人・1か月の保険料を「給与明細の形」にする（保険ごとに 本人・会社・全額）。11/16
// Angular・Firebase に依存しない純粋な関数
//
// - 端数処理は「まとめて1回」（合算なら 健保・介護・支援金）。保険ごとの本人分は端数処理の前の額
//   → まとめた単位に2つ以上の保険があるときは、その下に「端数処理のあと」の行を出す
// - 拠出金は保険料ではなく会社だけが納めるので、合計の下に別に出す（合計には入れない）

import type { Milli, PremiumPart, PremiumResult } from '../../../core/models/premium';

export interface SlipRow {
  kind: 'line' | 'rounded';
  /** line のとき：どの保険か。rounded のとき：まとめた保険 */
  parts: PremiumPart[];
  /** 本人分。line は端数処理の前（銭が出ることがある）、rounded と1行だけの単位は端数処理のあと */
  employeeMilli: Milli;
  employerMilli: Milli;
  totalMilli: Milli;
}

export interface Slip {
  rows: SlipRow[];
  total: { employeeYen: number; employerMilli: Milli; totalMilli: Milli };
  /** 拠出金（会社だけ）。かからない月は null */
  contribution: { employerMilli: Milli } | null;
}

export function premiumSlip(result: PremiumResult): Slip {
  const rows: SlipRow[] = [];
  let employeeYen = 0;
  let employerMilli = 0;
  let totalMilli = 0;
  let contributionMilli: Milli | null = null;

  for (const g of result.groups) {
    if (g.parts.includes('childContribution')) {
      const t = g.lines.reduce((s, l) => s + l.totalMilli, 0);
      contributionMilli = (contributionMilli ?? 0) + t;
      continue;
    }
    employeeYen += g.employeeYen;
    employerMilli += g.employerMilli;
    totalMilli += g.totalMilli;
    if (g.lines.length === 1) {
      // 1つだけの単位は、端数処理のあとの額をそのまま出す（行を増やさない）
      const l = g.lines[0];
      rows.push({
        kind: 'line',
        parts: [l.part],
        employeeMilli: g.employeeYen * 1000,
        employerMilli: g.employerMilli,
        totalMilli: l.totalMilli,
      });
      continue;
    }
    for (const l of g.lines) {
      rows.push({
        kind: 'line',
        parts: [l.part],
        employeeMilli: l.employeeMilli,
        employerMilli: l.totalMilli - l.employeeMilli,
        totalMilli: l.totalMilli,
      });
    }
    rows.push({
      kind: 'rounded',
      parts: [...g.parts],
      employeeMilli: g.employeeYen * 1000,
      employerMilli: g.employerMilli,
      totalMilli: g.totalMilli,
    });
  }
  const contribution = contributionMilli === null ? null : { employerMilli: contributionMilli };
  return { rows, total: { employeeYen, employerMilli, totalMilli }, contribution };
}
