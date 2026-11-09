// 現物給与の価額（R6）
// Angular・Firebase に依存しない純粋な関数
//
// 食事・住宅を現物で出しているときは、厚生労働大臣が定める価額（都道府県ごと）で円に直して報酬に入れる
//   - 使う表：その月に効いている表（masterInKind。from がその月以前でいちばん新しいもの）
//   - 使う都道府県：勤務地（人事・労務・給与の管理をしている事業所の所在地。社宅のある県ではない）
//     → 初期値は事業所の都道府県。本社と支店で1つの適用事業所のときなどは、計算の画面で選び直す
//   - 食事：1か月3食とも毎日なら月額。そうでなければ 朝・昼・夕 の回数 × 1食の額
//           本人負担が価額の 3分の2 以上なら報酬に入れない。未満なら 価額 − 本人負担
//   - 住宅：1畳（2026-09まで）／総面積1平方メートル（2026-10から）の額 × 広さ − 本人負担
//           月の途中から入居したら日割：1か月の価額 × 入居日以降の日数 ÷ その月の日数（1円未満切り捨て）
//   - 計算で出た1円未満は切り捨てる
//   - 健康保険組合が規約で別の価額を決めているときは、健康保険はそちらによる（ここでは扱わない）
//   - 自社製品・通勤定期券などは時価（ここでは扱わない）

import type { InKindDoc, InKindPrefecture } from '../../../core/models/master';
import { DATE_RE, daysInMonth, toYearMonth, YearMonth } from '../../../shared/utils/date';

export type InKindTableLike = Pick<InKindDoc, 'from' | 'housingUnit' | 'prefectures'>;

/** その月に効いている表（なければ null） */
export function inKindTableAt<T extends Pick<InKindDoc, 'from'>>(tables: readonly T[], month: YearMonth): T | null {
  let best: T | null = null;
  for (const t of tables) {
    if (t.from <= month && (!best || t.from > best.from)) best = t;
  }
  return best;
}

export interface MealInput {
  /** 1か月、3食とも毎日出している（月額を使う） */
  fullMonth: boolean;
  breakfasts: number; // 回数
  lunches: number;
  dinners: number;
  /** その月の食事について本人が払った額（円） */
  employeePays: number;
}

export interface HousingInput {
  /** 広さ：表の単位（畳 か 平方メートル）。小数でもよい */
  size: number;
  /** 月の途中から入居したときの日割：入居日以降の日数とその月の日数（null ＝ 1か月まるごと） */
  proration: { days: number; daysInMonth: number } | null;
  /** その月の住宅について本人が払った額（円） */
  employeePays: number;
}

export interface InKindInput {
  meal: MealInput | null;
  housing: HousingInput | null;
}

export interface InKindPart {
  value: number; // 価額（円）
  employeePays: number;
  /** 報酬に入れる額 */
  counted: number;
  /** 食事：本人負担が3分の2以上で、報酬に入れない */
  twoThirds: boolean;
}

export interface InKindResult {
  meal: InKindPart | null;
  housing: InKindPart | null;
  total: number;
}

/** 食事の価額（本人負担を引く前） */
export function mealValue(p: InKindPrefecture, m: MealInput): number {
  if (m.fullMonth) return p.meal.month;
  return p.meal.breakfast * m.breakfasts + p.meal.lunch * m.lunches + p.meal.dinner * m.dinners;
}

/** 住宅の価額（本人負担を引く前。1円未満切り捨て） */
export function housingValue(p: InKindPrefecture, h: HousingInput): number {
  // 小数の広さ（25.5㎡ など）で誤差が出ないように、0.01 単位の整数にしてから掛ける。
  // 日割も掛け算をすべて済ませてから1回だけ割る（切り捨ては最後に1回）
  const hundredths = Math.round(h.size * 100);
  const days = h.proration ? Math.min(h.proration.days, h.proration.daysInMonth) : 1;
  const dim = h.proration ? h.proration.daysInMonth : 1;
  return Math.floor((p.housing * hundredths * days) / (100 * dim));
}

export function inKindAmount(p: InKindPrefecture, input: InKindInput): InKindResult {
  let meal: InKindPart | null = null;
  if (input.meal) {
    const value = mealValue(p, input.meal);
    const pays = input.meal.employeePays;
    // 3分の2 以上か：割り算をしないで比べる（pays ≧ value × 2/3 ⇔ pays × 3 ≧ value × 2）
    const twoThirds = value > 0 && pays * 3 >= value * 2;
    meal = { value, employeePays: pays, counted: twoThirds ? 0 : Math.max(0, value - pays), twoThirds };
  }
  let housing: InKindPart | null = null;
  if (input.housing) {
    const value = housingValue(p, input.housing);
    const pays = input.housing.employeePays;
    housing = { value, employeePays: pays, counted: Math.max(0, value - pays), twoThirds: false };
  }
  return { meal, housing, total: (meal?.counted ?? 0) + (housing?.counted ?? 0) };
}

// ===== 入力の文字 → 数 =====

export interface InKindFormValue {
  useMeal: boolean;
  fullMonth: boolean;
  breakfasts: string;
  lunches: string;
  dinners: string;
  mealPays: string;
  useHousing: boolean;
  size: string;
  /** 月の途中から入居した日（空 ＝ 1か月まるごと） */
  movedIn: string;
  housingPays: string;
}

export type InKindFormError = 'count' | 'yen' | 'size' | 'movedIn' | 'nothing';

export function emptyInKindForm(): InKindFormValue {
  return {
    useMeal: false,
    fullMonth: false,
    breakfasts: '',
    lunches: '',
    dinners: '',
    mealPays: '',
    useHousing: false,
    size: '',
    movedIn: '',
    housingPays: '',
  };
}

const COUNT_RE = /^\d{1,3}$/;
const YEN_RE = /^\d{1,9}$/;
const SIZE_RE = /^\d{1,4}(\.\d{1,2})?$/;
const num = (s: string) => (s.trim() === '' ? 0 : Number(s.trim().replace(/,/g, '')));

/** 読めれば InKindInput、読めなければエラーの一覧（month は入居日がその月の日かを確かめるため） */
export function readInKindForm(
  v: InKindFormValue,
  month: YearMonth,
): { input: InKindInput } | { errors: InKindFormError[] } {
  const errors = new Set<InKindFormError>();
  const okCount = (s: string) => s.trim() === '' || (COUNT_RE.test(s.trim()) && Number(s) <= 93);
  const okYen = (s: string) => s.trim() === '' || YEN_RE.test(s.trim().replace(/,/g, ''));
  if (!v.useMeal && !v.useHousing) errors.add('nothing');
  if (v.useMeal) {
    if (!v.fullMonth && ![v.breakfasts, v.lunches, v.dinners].every(okCount)) errors.add('count');
    if (!okYen(v.mealPays)) errors.add('yen');
  }
  if (v.useHousing) {
    if (!SIZE_RE.test(v.size.trim()) || Number(v.size) <= 0) errors.add('size');
    if (!okYen(v.housingPays)) errors.add('yen');
    if (v.movedIn && (!DATE_RE.test(v.movedIn) || toYearMonth(v.movedIn) !== month)) errors.add('movedIn');
  }
  if (errors.size > 0) return { errors: [...errors] };
  return {
    input: {
      meal: v.useMeal
        ? {
            fullMonth: v.fullMonth,
            breakfasts: v.fullMonth ? 0 : num(v.breakfasts),
            lunches: v.fullMonth ? 0 : num(v.lunches),
            dinners: v.fullMonth ? 0 : num(v.dinners),
            employeePays: num(v.mealPays),
          }
        : null,
      housing: v.useHousing
        ? { size: Number(v.size.trim()), proration: prorationOf(v.movedIn, month), employeePays: num(v.housingPays) }
        : null,
    },
  };
}

/** 入居した日から日割の日数（1日に入居 ＝ 1か月まるごと） */
export function prorationOf(movedIn: string, month: YearMonth): HousingInput['proration'] {
  if (!movedIn) return null;
  const day = Number(movedIn.slice(8, 10));
  if (day <= 1) return null;
  const dim = daysInMonth(month);
  return { days: dim - day + 1, daysInMonth: dim };
}
