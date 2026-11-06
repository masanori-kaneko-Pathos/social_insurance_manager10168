/**
 * 報酬月額から標準報酬月額の等級を決める
 * Angular・Firebase に依存しない純粋な関数だけで書く（等級表は引数で受け取る）。
 */
import { GradeRow, GradeTableDoc } from '../../../core/models/rates';
import { StandardRemuneration } from '../../../core/models/remuneration';
import { latest } from './pick-rates';
import { toHalfWidth } from '../../../shared/utils/text';

/** 報酬月額として受け付ける上限（1億円未満） */
const MAX_AMOUNT = 99_999_999;

/** その月に使う等級表（なければ null） */
export function pickGradeTable(
  tables: GradeTableDoc[],
  kind: GradeTableDoc['kind'],
  month: string,
): GradeTableDoc | null {
  return latest(
    tables.filter((t) => t.kind === kind),
    month,
  );
}

/** 報酬月額 → 等級（報酬月額が min 以上の行のうち、一番上の行） */
export function gradeOf(rows: GradeRow[], monthlyAmount: number): StandardRemuneration {
  if (!Number.isSafeInteger(monthlyAmount) || monthlyAmount < 0) {
    throw new Error(`報酬月額が正しくありません: ${monthlyAmount}`);
  }
  let found: GradeRow | null = null;
  for (const row of rows) {
    if (row.min <= monthlyAmount && (!found || row.min > found.min)) found = row;
  }
  if (!found) throw new Error('等級表が空です');
  return { grade: found.grade, standard: found.standard };
}

/** その月の等級表で、健保・厚年それぞれの等級を決める（等級表がなければ null） */
export function decideStandard(
  tables: GradeTableDoc[],
  month: string,
  monthlyAmount: number,
): { health: StandardRemuneration | null; pension: StandardRemuneration | null } {
  const health = pickGradeTable(tables, 'health', month);
  const pension = pickGradeTable(tables, 'pension', month);
  return {
    health: health ? gradeOf(health.grades, monthlyAmount) : null,
    pension: pension ? gradeOf(pension.grades, monthlyAmount) : null,
  };
}

/**
 * 金額の文字列 → 整数（円）
 * '300000'、'300,000'、'３００，０００' を受け付ける。読めないもの・上限超えは null
 */
export function parseYen(input: string): number | null {
  const s = toHalfWidth(input).replace(/[,\s]/g, '');
  if (!/^\d{1,8}$/.test(s)) return null;
  const n = Number(s);
  return n <= MAX_AMOUNT ? n : null;
}
