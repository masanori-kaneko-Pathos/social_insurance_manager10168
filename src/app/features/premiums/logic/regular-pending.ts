// 定時決定がまだ反映されていない人（保険料一覧の上に知らせる。11/19）
// Angular・Firebase に依存しない純粋な関数
//
// 定時決定（健保法41条・厚年法21条）：7月1日に使用されている被保険者は、4〜6月の報酬で9月分から標準報酬が決まり直す。
// ただし 6月1日以降に資格を取った人と、7〜9月に随時改定（休業終了時改定・特例改定を含む）がある人は対象外。
// このアプリでは、定時決定の画面で「反映」すると、その年の9月分の標準報酬（決定の記録）ができる。
// 9月分〜翌年8月分の保険料を見ているのに、その年の 7・8・9月分の記録がない人は、前の標準報酬で計算されている。
import type { DateStr, YearMonth } from '../../../shared/utils/date';

export interface PendingPerson {
  id: string;
  health: { acquiredDate: string | null };
  pension: { acquiredDate: string | null };
  /** 標準報酬の記録（from だけ使う） */
  remunerations: readonly { from: string }[];
}

/** その月の保険料に効く定時決定の年（9月分〜翌年8月分は、その年の定時決定） */
export function regularYearFor(month: YearMonth): number {
  const y = Number(month.slice(0, 4));
  return Number(month.slice(5, 7)) >= 9 ? y : y - 1;
}

/**
 * 定時決定が反映されていない人
 * - people には、その月に保険料がかかっている（または免除の）人だけを渡す
 * - その年の7月1日より前は、まだ定時決定の時期ではないので null
 * - 今の定時決定（今日の月に効く年）だけを見る。前の年の分は過去の記録の話なので知らせない
 * - 対象の人がいなければ null
 */
export function regularPending(
  people: readonly PendingPerson[],
  month: YearMonth,
  today: DateStr,
): { year: number; ids: string[] } | null {
  const year = regularYearFor(month);
  if (today < `${year}-07-01`) return null;
  if (year !== regularYearFor(today.slice(0, 7))) return null;
  const june = `${year}-06-01`;
  const decided = new Set([`${year}-07`, `${year}-08`, `${year}-09`]);
  const ids: string[] = [];
  for (const p of people) {
    const dates = [p.health.acquiredDate, p.pension.acquiredDate].filter((d): d is string => !!d);
    if (dates.length === 0) continue;
    const acquired = dates.sort()[0];
    if (acquired >= june) continue; // 6月1日以降に資格を取った人は対象外
    if (p.remunerations.some((r) => decided.has(r.from))) continue; // 定時決定・7〜9月の改定が入っている
    ids.push(p.id);
  }
  return ids.length > 0 ? { year, ids } : null;
}
