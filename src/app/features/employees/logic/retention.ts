// 退職した人のデータの保存期間（11/27。台帳 R110〜R113）
// Angular・Firebase に依存しない純粋な関数。サーバーの関数（functions/src/employee-delete-rules.ts）にも同じ決まりがある
//
// - 保存の方針は5年（労働基準法109条の本則。143条1項の経過措置で当分は3年だが、本則に合わせる）
// - 数え始める日は、次のうちいちばん遅い日（労働基準法施行規則56条。名簿は退職の日、賃金台帳は最後に記入した日、
//   賃金の支払期日がそれより遅ければ支払期日）
//   ・退職日 ・最後の給与の支払月の末日（支払日の代わりに、遅いほうへ寄せて月末） ・最後の賞与の支払日
// - 5年たった次の日から消せる
// - 社会保険の書類の2年（健保則34条・厚年則28条）は5年に含まれるので、ここでは数えない

import { addDays, DateStr, daysInMonth, YearMonth } from '../../../shared/utils/date';

export const RETENTION_YEARS = 5;

export interface RetentionFacts {
  retireDate: DateStr | null;
  /** 最後に給与を記録した支払月（なければ null） */
  lastPaidMonth: YearMonth | null;
  /** 最後に賞与を払った日（なければ null） */
  lastBonusDate: DateStr | null;
}

/** n年後の同じ日（2月29日は、その年に29日がなければ28日） */
export function addYears(date: DateStr, years: number): DateStr {
  const y = Number(date.slice(0, 4)) + years;
  const m = date.slice(5, 7);
  const d = Math.min(Number(date.slice(8, 10)), daysInMonth(`${y}-${m}`));
  return `${y}-${m}-${String(d).padStart(2, '0')}`;
}

/** 数え始める日（退職していなければ null） */
export function retentionBase(f: RetentionFacts): DateStr | null {
  if (!f.retireDate) return null;
  const monthEnd = f.lastPaidMonth ? `${f.lastPaidMonth}-${String(daysInMonth(f.lastPaidMonth)).padStart(2, '0')}` : null;
  return [f.retireDate, monthEnd, f.lastBonusDate].filter((d): d is DateStr => !!d).sort().at(-1)!;
}

/** 消せるようになる日（退職していなければ null） */
export function deletableOn(f: RetentionFacts): DateStr | null {
  const base = retentionBase(f);
  return base ? addDays(addYears(base, RETENTION_YEARS), 1) : null;
}

/**
 * To-do に出すか（退職日だけで見る。給与・賞与までは読まないので、少し早めに出ることがある）
 * 正しい日は従業員の詳細で、給与・賞与も読んで出す
 */
export function retentionCandidate(retireDate: DateStr | null, today: DateStr): boolean {
  return !!retireDate && addDays(addYears(retireDate, RETENTION_YEARS), 1) <= today;
}
