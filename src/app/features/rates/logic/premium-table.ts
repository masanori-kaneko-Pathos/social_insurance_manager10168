// 保険料額表（等級ごとの保険料の表。協会けんぽの「保険料額表」と同じ形。11/26）
// マスタのタブで、その事業所のその月の料率と等級表から組み立てて見せる（閲覧だけ）
// Angular・Firebase に依存しない純粋な関数

import type { GradeRow, PickedRate, RatesForMonth } from '../../../core/models/rates';
import { milliOf } from '../../premiums/logic/rounding';

/** 1つの保険の額（1/1000円）：全額・本人分・会社分 */
export interface TableAmount {
  total: number;
  employee: number;
  employer: number;
}

export interface PremiumTableRow {
  /** 健康保険の等級 */
  grade: number;
  /** 厚生年金の等級（同じ標準報酬月額の等級がなければ null） */
  pensionGrade: number | null;
  standard: number;
  /** 報酬月額の範囲（以上・未満。最後の行は null） */
  min: number;
  max: number | null;
  /** 健康保険（介護保険がかからない人） */
  health: TableAmount | null;
  /** 健康保険＋介護保険（40歳から64歳の人） */
  healthCare: TableAmount | null;
  /** 子ども・子育て支援金（料率がない月は null） */
  childSupport: TableAmount | null;
  /** 厚生年金保険（同じ標準報酬月額の等級がある行だけ） */
  pension: TableAmount | null;
}

function amountOf(standard: number, rates: (PickedRate | null)[]): TableAmount | null {
  if (rates.some((r) => r === null)) return null;
  const employee = rates.reduce((s, r) => s + milliOf(standard, r!.employee), 0);
  const employer = rates.reduce((s, r) => s + milliOf(standard, r!.employer), 0);
  return { total: employee + employer, employee, employer };
}

/**
 * 健康保険の等級表の行ごとに、その月の料率で保険料を出す
 * 厚生年金は、同じ標準報酬月額の等級がある行だけ（協会けんぽの額表と同じ。88,000円未満・上限を超える行は空）
 */
export function premiumTable(
  health: readonly GradeRow[],
  pension: readonly GradeRow[],
  rates: RatesForMonth,
): PremiumTableRow[] {
  const rows = [...health].sort((a, b) => a.min - b.min);
  const support =
    rates.childSupport && rates.childSupport.employee + rates.childSupport.employer > 0
      ? rates.childSupport
      : null;
  return rows.map((g, i) => {
    const p = pension.find((x) => x.standard === g.standard) ?? null;
    return {
      grade: g.grade,
      pensionGrade: p?.grade ?? null,
      standard: g.standard,
      min: g.min,
      max: rows[i + 1]?.min ?? null,
      health: amountOf(g.standard, [rates.health]),
      healthCare: amountOf(g.standard, [rates.health, rates.care]),
      childSupport: support ? amountOf(g.standard, [support]) : null,
      pension: p ? amountOf(g.standard, [rates.pension]) : null,
    };
  });
}

/** 本人と会社が半分ずつか（協会けんぽは折半。組合は規約で違うことがある） */
export function isHalf(rates: RatesForMonth): boolean {
  return [rates.health, rates.care, rates.childSupport, rates.pension].every(
    (r) => !r || r.employee === r.employer,
  );
}
