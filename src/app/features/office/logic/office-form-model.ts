/**
 * 事業所の設定のうち「社会保険の適用」と「賞与・現物」の欄
 * 画面の値（文字とチェック）⇔ 保存する形（OfficeInput の一部）
 * Angular・Firebase に依存しない純粋な関数
 */
import { InKindProvided, OfficeDoc, SpecificApplication, StandardHours } from '../../../core/models/office';
import { formatHours, parseNat } from '../../../shared/utils/number';
import { YEAR_MONTH_RE } from '../../../shared/utils/date';
import { WEEK_MAX_MINUTES, weeklyMinutesOf } from '../../employees/logic/contract-form-model';

/** 通常の労働者の所定の入れ方（週の時間 or 月の時間。月は × 12/52 で週に直す） */
export type StandardHoursUnit = 'week' | 'month';

/** 特定適用事業所の選び方 */
export type SpecificChoice = 'none' | 'applied' | 'voluntary';
export const SPECIFIC_CHOICES: readonly SpecificChoice[] = ['none', 'applied', 'voluntary'];

/** 週の所定の候補ボタン（法定労働時間の週40時間） */
export const STANDARD_HOURS_CANDIDATE = '40:00';

/** 賞与の支払予定月がこの回数以上なら注意（年4回以上は賞与ではなく報酬） */
export const BONUS_TIMES_AS_PAY = 4;

export const MONTHS_OF_YEAR: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export interface CoverageFormValue {
  hoursUnit: StandardHoursUnit;
  hours: string; // '40:00'・'40'・'173:20'
  monthlyDays: string;
  specific: SpecificChoice;
  specificSince: string; // 'YYYY-MM'
  insuredCount: string; // 空 ＝ アプリの中で数える
  pensionFund: boolean;
  bonusMonths: number[];
  housing: boolean;
  meals: boolean;
}

/** 保存する形（OfficeInput のうち、このまとまりの項目） */
export type CoverageInput = Pick<
  OfficeDoc,
  'standardHours' | 'specificApplication' | 'pensionFund' | 'inKind' | 'bonusMonths'
>;

// ===== 初期値・保存した形 → 画面 =====

/** 項目がない古いデータも受け取れる形 */
type OfficeLike = Partial<CoverageInput>;

export function emptyCoverageForm(): CoverageFormValue {
  return {
    hoursUnit: 'week',
    hours: '',
    monthlyDays: '',
    specific: 'none',
    specificSince: '',
    insuredCount: '',
    pensionFund: false,
    bonusMonths: [],
    housing: false,
    meals: false,
  };
}

function specificChoiceOf(s: SpecificApplication | undefined): SpecificChoice {
  if (!s?.since) return 'none';
  return s.voluntary ? 'voluntary' : 'applied';
}

/** 保存した形 → 画面（時間は週で見せる） */
export function toCoverageForm(o: OfficeLike): CoverageFormValue {
  const h: StandardHours | null = o.standardHours ?? null;
  const s = o.specificApplication;
  const k: InKindProvided | undefined = o.inKind;
  return {
    hoursUnit: 'week',
    hours: h ? formatHours(h.weeklyMinutes) : '',
    monthlyDays: h ? String(h.monthlyDays) : '',
    specific: specificChoiceOf(s),
    specificSince: s?.since ?? '',
    insuredCount: s?.insuredCount == null ? '' : String(s.insuredCount),
    pensionFund: o.pensionFund ?? false,
    bonusMonths: normalizeMonths(o.bonusMonths ?? []),
    housing: k?.housing ?? false,
    meals: k?.meals ?? false,
  };
}

// ===== 賞与の月 =====

/** 1〜12 だけを、重複なしで小さい順に */
export function normalizeMonths(list: number[]): number[] {
  return [...new Set(list)].filter((m) => Number.isInteger(m) && m >= 1 && m <= 12).sort((a, b) => a - b);
}

/** 月のトグル：入っていれば外す、なければ足す */
export function toggleMonth(list: number[], month: number): number[] {
  return list.includes(month)
    ? list.filter((m) => m !== month)
    : normalizeMonths([...list, month]);
}

// ===== 計算の道具 =====

/** 入れた時間 → 週の所定（分）。空なら null、読めなければ undefined */
export function standardWeeklyMinutes(v: Pick<CoverageFormValue, 'hoursUnit' | 'hours'>) {
  return weeklyMinutesOf(v.hoursUnit, v.hours);
}

/** 人数の欄（空 ＝ null。読めなければ undefined） */
export function insuredCountOf(v: Pick<CoverageFormValue, 'insuredCount'>) {
  return parseNat(v.insuredCount);
}

// ===== チェック =====

export type CoverageError =
  | 'hours' // 時間が読めない・0
  | 'hoursRange' // 週168時間を超える
  | 'days' // 1〜31 ではない
  | 'pair' // 時間と日数の片方だけ
  | 'since' // 該当・任意なのに月がない
  | 'count'; // 人数が読めない

export type CoverageErrors = Partial<Record<keyof CoverageFormValue, CoverageError>>;

/** 保存できない理由（欄の名前 → エラー）。空なら保存できる */
export function coverageErrors(v: CoverageFormValue): CoverageErrors {
  const e: CoverageErrors = {};

  const weekly = standardWeeklyMinutes(v);
  if (weekly === undefined || weekly === 0) e.hours = 'hours';
  else if (weekly !== null && weekly > WEEK_MAX_MINUTES) e.hours = 'hoursRange';

  const days = parseNat(v.monthlyDays);
  if (days === undefined || (days !== null && (days < 1 || days > 31))) e.monthlyDays = 'days';

  // 時間と日数はセットで持つ（両方空なら「未設定」、片方だけは保存しない）
  if (!e.hours && !e.monthlyDays) {
    if (weekly === null && days !== null) e.hours = 'pair';
    if (weekly !== null && days === null) e.monthlyDays = 'pair';
  }

  if (v.specific !== 'none' && !YEAR_MONTH_RE.test(v.specificSince)) e.specificSince = 'since';
  if (insuredCountOf(v) === undefined) e.insuredCount = 'count';
  return e;
}

export type CoverageWarning =
  | 'noStandardHours' // 所定が空：4分の3基準が判定できない
  | 'maybeSpecific' // 該当しないのに、人数が基準以上
  | 'bonusAsPay'; // 賞与が年4回以上

export interface WarningContext {
  /** 企業規模の人数（手で入れた人数があればそれ、なければアプリで数えた人数。数えていなければ null） */
  headcount: number | null;
  /** 今の基準の人数（masterCriteria。規模の要件がなければ null） */
  sizeMin: number | null;
}

/** 注意（保存はできる） */
export function coverageWarnings(v: CoverageFormValue, ctx: WarningContext): CoverageWarning[] {
  const w: CoverageWarning[] = [];
  if (standardWeeklyMinutes(v) === null && parseNat(v.monthlyDays) === null) w.push('noStandardHours');
  if (
    v.specific === 'none' &&
    ctx.headcount !== null &&
    ctx.sizeMin !== null &&
    ctx.headcount >= ctx.sizeMin
  ) {
    w.push('maybeSpecific');
  }
  if (normalizeMonths(v.bonusMonths).length >= BONUS_TIMES_AS_PAY) w.push('bonusAsPay');
  return w;
}

// ===== 画面 → 保存する形 =====

/** 画面の値を保存する形に。チェックを通らなければ null */
export function fromCoverageForm(v: CoverageFormValue): CoverageInput | null {
  if (Object.keys(coverageErrors(v)).length > 0) return null;
  const weekly = standardWeeklyMinutes(v);
  const days = parseNat(v.monthlyDays);
  const count = insuredCountOf(v);
  return {
    standardHours:
      weekly == null || days == null ? null : { weeklyMinutes: weekly, monthlyDays: days },
    specificApplication: {
      since: v.specific === 'none' ? null : v.specificSince,
      voluntary: v.specific === 'voluntary',
      insuredCount: count ?? null,
    },
    pensionFund: v.pensionFund,
    inKind: { housing: v.housing, meals: v.meals },
    bonusMonths: normalizeMonths(v.bonusMonths),
  };
}
