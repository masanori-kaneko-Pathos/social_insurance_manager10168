// 従業員一覧のフィルター（複数の条件を組み合わせる）
// Angular・Firebase に依存しない純粋な関数
// - 同じ条件の中で複数選んだら「どれか」、違う条件どうしは「どれも」
// - URL のクエリ（文字）⇔ 条件 を行き来できる

import type { EmploymentType } from '../../../core/models/contract';
import { EMPLOYMENT_TYPES } from '../../../core/models/contract';
import type { Employee } from '../../../core/models/employee';
import { ageAt, DateStr, YearMonth } from '../../../shared/utils/date';
import type { Category } from './classify';
import { coverageForMonth } from './coverage';

export const COVERAGE_OPTIONS = ['health', 'pension', 'care', 'none'] as const;
export type CoverageOption = (typeof COVERAGE_OPTIONS)[number];

export const CATEGORY_OPTIONS: readonly Category[] = ['regular', 'shortTime', 'reducedWage', 'excluded', 'unknown'];
export const SEX_OPTIONS = ['male', 'female', 'unset'] as const;
export type SexOption = (typeof SEX_OPTIONS)[number];
export const NATIONALITY_OPTIONS = ['japan', 'foreign'] as const;
export type NationalityOption = (typeof NATIONALITY_OPTIONS)[number];
export const EMPLOYMENT_OPTIONS = EMPLOYMENT_TYPES;

export interface EmployeeFilter {
  coverage: CoverageOption[];
  category: Category[];
  employment: EmploymentType[];
  hireFrom: DateStr | null;
  hireTo: DateStr | null;
  ageMin: number | null;
  ageMax: number | null;
  sex: SexOption[];
  nationality: NationalityOption[];
}

export function emptyFilter(): EmployeeFilter {
  return {
    coverage: [],
    category: [],
    employment: [],
    hireFrom: null,
    hireTo: null,
    ageMin: null,
    ageMax: null,
    sex: [],
    nationality: [],
  };
}

/** 使っている条件の数（ボタンに出す） */
export function activeCount(f: EmployeeFilter): number {
  return [
    f.coverage.length > 0,
    f.category.length > 0,
    f.employment.length > 0,
    !!f.hireFrom || !!f.hireTo,
    f.ageMin !== null || f.ageMax !== null,
    f.sex.length > 0,
    f.nationality.length > 0,
  ].filter(Boolean).length;
}

/** 契約を読まないと判定できない条件を使っているか */
export function needsContracts(f: EmployeeFilter): boolean {
  return f.category.length > 0 || f.employment.length > 0;
}

// ===== URL ⇔ 条件 =====

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const list = <T extends string>(raw: string | null, allowed: readonly T[]): T[] =>
  (raw ?? '')
    .split(',')
    .filter((x): x is T => (allowed as readonly string[]).includes(x));
const age = (raw: string | null): number | null => {
  if (!raw || !/^\d{1,3}$/.test(raw)) return null;
  return Number(raw);
};

/** クエリの値を読む関数（ParamMap.get と同じ形） */
export function filterFromQuery(get: (key: string) => string | null): EmployeeFilter {
  return {
    coverage: list(get('cov'), COVERAGE_OPTIONS),
    category: list(get('cat'), CATEGORY_OPTIONS),
    employment: list(get('emp'), EMPLOYMENT_OPTIONS),
    hireFrom: DATE.test(get('hireFrom') ?? '') ? get('hireFrom') : null,
    hireTo: DATE.test(get('hireTo') ?? '') ? get('hireTo') : null,
    ageMin: age(get('ageMin')),
    ageMax: age(get('ageMax')),
    sex: list(get('sex'), SEX_OPTIONS),
    nationality: list(get('nat'), NATIONALITY_OPTIONS),
  };
}

/** 条件 → クエリ（使っていない条件は null ＝ URL から消す） */
export function filterToQuery(f: EmployeeFilter): Record<string, string | null> {
  const join = (xs: readonly string[]) => (xs.length ? xs.join(',') : null);
  return {
    cov: join(f.coverage),
    cat: join(f.category),
    emp: join(f.employment),
    hireFrom: f.hireFrom,
    hireTo: f.hireTo,
    ageMin: f.ageMin === null ? null : String(f.ageMin),
    ageMax: f.ageMax === null ? null : String(f.ageMax),
    sex: join(f.sex),
    nat: join(f.nationality),
  };
}

/** 選択肢の付け外し（並びは選択肢の順） */
export function toggle<T extends string>(selected: readonly T[], value: T, order: readonly T[]): T[] {
  const next = selected.includes(value) ? selected.filter((x) => x !== value) : [...selected, value];
  return order.filter((x) => next.includes(x));
}

// ===== 判定 =====

export interface FilterContext {
  today: DateStr;
  month: YearMonth;
  /** 今日の区分（契約を読んでいなければ undefined） */
  category?: Category;
  /** 今日の契約の雇用形態（契約がなければ null、読んでいなければ undefined） */
  employment?: EmploymentType | null;
}

type FilterTarget = Pick<Employee, 'birthDate' | 'hireDate' | 'health' | 'pension' | 'sex' | 'foreign'>;

export function matchesFilter(e: FilterTarget, f: EmployeeFilter, ctx: FilterContext): boolean {
  if (f.coverage.length > 0) {
    const c = coverageForMonth(e, ctx.month);
    const hit = f.coverage.some((o) =>
      o === 'health' ? c.health : o === 'pension' ? c.pension : o === 'care' ? c.care : !c.health && !c.pension,
    );
    if (!hit) return false;
  }
  // 契約の材料がまだないときは、絞らずに出す（読み終わったら絞る）
  if (f.category.length > 0 && ctx.category !== undefined && !f.category.includes(ctx.category)) return false;
  if (f.employment.length > 0 && ctx.employment !== undefined) {
    if (!ctx.employment || !f.employment.includes(ctx.employment)) return false;
  }
  if (f.hireFrom && e.hireDate < f.hireFrom) return false;
  if (f.hireTo && e.hireDate > f.hireTo) return false;
  if (f.ageMin !== null || f.ageMax !== null) {
    const a = ageAt(e.birthDate, ctx.today);
    if (f.ageMin !== null && a < f.ageMin) return false;
    if (f.ageMax !== null && a > f.ageMax) return false;
  }
  if (f.sex.length > 0 && !f.sex.includes(e.sex ?? 'unset')) return false;
  if (f.nationality.length > 0 && !f.nationality.includes(e.foreign ? 'foreign' : 'japan')) return false;
  return true;
}
