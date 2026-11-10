/**
 * 月額・賞与で共通の部品：計算過程（PremiumLine）を作り、端数処理の単位（PremiumGroup）にまとめる
 */
import {
  Milli,
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

/** 1人分の結果を「保険料」と「拠出金（会社だけが納める、保険料ではないもの）」に分けた金額 */
export interface PremiumSplit {
  premiumTotalMilli: Milli; // 保険料の全額（健保・介護・支援金・厚年。額表の数字と一致する）
  premiumEmployerMilli: Milli; // 保険料の会社負担の目安（保険料の全額 − 本人負担）
  contributionMilli: Milli; // 子ども・子育て拠出金
}

export function splitContribution(result: PremiumResult): PremiumSplit {
  const isContribution = (g: PremiumGroup) => g.parts.includes('childContribution');
  const premiumTotalMilli = result.groups
    .filter((g) => !isContribution(g))
    .reduce((s, g) => s + g.totalMilli, 0);
  const contributionMilli = result.groups
    .filter(isContribution)
    .reduce((s, g) => s + g.totalMilli, 0);
  return {
    premiumTotalMilli,
    premiumEmployerMilli: premiumTotalMilli - yenToMilli(result.employeeYen),
    contributionMilli,
  };
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

/**
 * 健康保険料の内訳（健康保険・介護保険・子ども・子育て支援金）の全額
 * 納付額は3つを合わせて1円未満を切り捨てるので、ここはそれぞれを切り捨てた目安（合計と1〜2円ずれることがある）
 * 本人負担は「合算してから端数処理」の設定だと保険ごとに決まらないので、全額だけを出す
 */
export function healthPartTotals(results: PremiumResult[]): { part: 'health' | 'care' | 'childSupport'; totalYen: number }[] {
  const parts = ['health', 'care', 'childSupport'] as const;
  const sums = new Map<PremiumPart, Milli>(parts.map((p) => [p, 0]));
  for (const r of results) {
    for (const g of r.groups) {
      for (const l of g.lines) {
        if (sums.has(l.part)) sums.set(l.part, sums.get(l.part)! + l.totalMilli);
      }
    }
  }
  return parts.map((part) => ({ part, totalYen: floorYen(sums.get(part)!) }));
}
