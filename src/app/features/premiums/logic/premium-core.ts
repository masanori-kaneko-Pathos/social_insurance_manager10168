/**
 * 月額・賞与で共通の部品：計算過程（PremiumLine）を作り、端数処理の単位（PremiumGroup）にまとめる
 */
import {
  OfficeTotal,
  PremiumGroup,
  PremiumLine,
  PremiumOptions,
  PremiumPart,
  PremiumResult,
} from '../../../core/models/premium';
import { PickedRate } from '../../../core/models/rates';
import { floorYen, milliOf, roundEmployee, yenToMilli } from './rounding';

/** 1つの保険料の計算過程 */
export function makeLine(
  part: PremiumPart,
  base: number,
  grade: number | null,
  rate: PickedRate,
): PremiumLine {
  return {
    part,
    base,
    grade,
    rate,
    totalMilli: milliOf(base, rate.employee + rate.employer),
    employeeMilli: milliOf(base, rate.employee),
  };
}

function makeGroup(lines: PremiumLine[], options: PremiumOptions): PremiumGroup {
  const totalMilli = lines.reduce((s, l) => s + l.totalMilli, 0);
  const employeeMilli = lines.reduce((s, l) => s + l.employeeMilli, 0);
  const employeeYen = roundEmployee(employeeMilli, options.method);
  return {
    parts: lines.map((l) => l.part),
    lines,
    totalMilli,
    employeeYen,
    employerMilli: totalMilli - yenToMilli(employeeYen),
  };
}

/**
 * 端数処理の単位にまとめる
 * - 健保・介護・支援金：合算（combined）なら1つにまとめて1回だけ端数処理、個別（separate）ならそれぞれ
 * - 厚年、拠出金：それぞれ別
 */
export function makeGroups(lines: PremiumLine[], options: PremiumOptions): PremiumGroup[] {
  const healthParts: PremiumPart[] = ['health', 'care', 'childSupport'];
  const healthLines = lines.filter((l) => healthParts.includes(l.part));
  const others = lines.filter((l) => !healthParts.includes(l.part));

  const groups: PremiumGroup[] = [];
  if (healthLines.length > 0) {
    if (options.healthRounding === 'combined') groups.push(makeGroup(healthLines, options));
    else for (const l of healthLines) groups.push(makeGroup([l], options));
  }
  for (const l of others) groups.push(makeGroup([l], options));
  return groups;
}

/** 結果全体の合計を足す */
export function withTotals(
  base: Omit<PremiumResult, 'totalMilli' | 'employeeYen' | 'employerMilli'>,
): PremiumResult {
  const totalMilli = base.groups.reduce((s, g) => s + g.totalMilli, 0);
  const employeeYen = base.groups.reduce((s, g) => s + g.employeeYen, 0);
  return { ...base, totalMilli, employeeYen, employerMilli: totalMilli - yenToMilli(employeeYen) };
}

/**
 * 事業所の合計（日本年金機構の考え方）
 * - 納付額：全員の全額を合計して、1円未満を切り捨て
 * - 会社負担：納付額 − 全員の本人負担の合計（1人ごとには決まらない）
 * 健保・介護・支援金は「健康保険料」として1つにまとめる。
 */
export function officeTotals(results: PremiumResult[]): OfficeTotal[] {
  const categoryOf = (part: PremiumPart): OfficeTotal['category'] =>
    part === 'pension' ? 'pension' : part === 'childContribution' ? 'childContribution' : 'health';

  const sums = new Map<OfficeTotal['category'], { total: number; employee: number }>();
  for (const cat of ['health', 'pension', 'childContribution'] as const)
    sums.set(cat, { total: 0, employee: 0 });

  for (const r of results) {
    for (const g of r.groups) {
      const s = sums.get(categoryOf(g.parts[0]))!;
      s.total += g.totalMilli;
      s.employee += g.employeeYen;
    }
  }

  return [...sums.entries()].map(([category, s]) => {
    const totalYen = floorYen(s.total);
    return { category, totalYen, employeeYen: s.employee, employerYen: totalYen - s.employee };
  });
}
