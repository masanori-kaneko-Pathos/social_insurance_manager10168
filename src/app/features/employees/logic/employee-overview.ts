/**
 * 従業員のページ「概要」のタブに出すもの（Angular・Firebase に依存しない純粋な関数）
 * - 今の標準報酬月額（その月に効いている行）
 * - 足りない情報（届書や保険料の計算で困るもの）と、直しに行くタブ
 */
import { YearMonth } from '../../../shared/utils/date';

export type EmployeeTab = 'overview' | 'employment' | 'insurance' | 'pay' | 'person' | 'history';
export const EMPLOYEE_TABS: readonly EmployeeTab[] = ['overview', 'employment', 'insurance', 'pay', 'person', 'history'];

/** URL の ?tab= から（知らない値は概要） */
export function tabOf(raw: string | null): EmployeeTab {
  return (EMPLOYEE_TABS as readonly string[]).includes(raw ?? '') ? (raw as EmployeeTab) : 'overview';
}

/** その月に効いている標準報酬（from がその月以前でいちばん新しい行。なければ null） */
export function remunerationAt<T extends { from: YearMonth }>(rows: readonly T[], month: YearMonth): T | null {
  let best: T | null = null;
  for (const r of rows) if (r.from <= month && (!best || r.from > best.from)) best = r;
  return best;
}

export type MissingInfo =
  | 'noContract' // 雇用契約がない（区分が判定できない）
  | 'noRemuneration' // 加入しているのに標準報酬月額がない（保険料が出ない）
  | 'noSex' // 性別がない（資格取得届の「種別」）
  | 'noBasicPensionNumber' // 厚年に加入しているのに基礎年金番号がない（取得届）
  | 'noInsuredNumber' // 加入しているのに被保険者整理番号がない（年金事務所から届いたら入れる）
  | 'noAddress'; // 住所がない（基礎年金番号で出す取得届・マイページ）

/** 直しに行くタブ */
export const MISSING_TAB: Record<MissingInfo, EmployeeTab> = {
  noContract: 'employment',
  noRemuneration: 'pay',
  noSex: 'person',
  noBasicPensionNumber: 'person',
  noInsuredNumber: 'person',
  noAddress: 'person',
};

export interface OverviewTarget {
  sex: string | null;
  basicPensionNumber: string | null;
  insuredNumber: string | null;
  health: { enrolled: boolean };
  pension: { enrolled: boolean };
  retireDate: string | null;
}

/**
 * 足りない情報
 * address：住所（読めない人＝一般ユーザーは undefined を渡す → 住所は見ない）
 */
export function missingInfo(
  e: OverviewTarget,
  opts: {
    hasContract: boolean;
    remunerationNow: boolean;
    address?: string | null;
    today: string;
  },
): MissingInfo[] {
  const out: MissingInfo[] = [];
  const retired = !!e.retireDate && e.retireDate < opts.today;
  const enrolled = e.health.enrolled || e.pension.enrolled;
  if (!retired && !opts.hasContract) out.push('noContract');
  if (!retired && enrolled && !opts.remunerationNow) out.push('noRemuneration');
  if (!e.sex) out.push('noSex');
  if (e.pension.enrolled && !e.basicPensionNumber) out.push('noBasicPensionNumber');
  if (enrolled && !e.insuredNumber) out.push('noInsuredNumber');
  if (opts.address !== undefined && !opts.address) out.push('noAddress');
  return out;
}
