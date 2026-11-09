import type { Employee } from '../../../core/models/employee';
import {
  activeCount,
  EmployeeFilter,
  emptyFilter,
  filterFromQuery,
  filterToQuery,
  matchesFilter,
  needsContracts,
  toggle,
  CATEGORY_OPTIONS,
} from './employee-filter';

const on = (d: string) => ({ enrolled: true, acquiredDate: d, lostDate: null, lossReason: null });
const off = { enrolled: false, acquiredDate: null, lostDate: null, lossReason: null };
const emp = (p: Partial<Employee> = {}) =>
  ({ birthDate: '1990-05-15', hireDate: '2024-04-01', health: on('2024-04-01'), pension: on('2024-04-01'), sex: 'male', foreign: null, ...p }) as Employee;
const CTX = { today: '2026-11-09', month: '2026-11' };
const f = (p: Partial<EmployeeFilter>): EmployeeFilter => ({ ...emptyFilter(), ...p });

describe('filterFromQuery / filterToQuery', () => {
  it('往復できる。知らない値・形の違う値は捨てる', () => {
    const q: Record<string, string> = {
      cov: 'health,care,xxx', cat: 'shortTime', emp: 'part,arbeit', hireFrom: '2026-01-01', hireTo: '2026/12/31',
      ageMin: '40', ageMax: 'abc', sex: 'female', nat: 'foreign',
    };
    const r = filterFromQuery((k) => q[k] ?? null);
    expect(r.coverage).toEqual(['health', 'care']);
    expect(r.hireTo).toBeNull();
    expect(r.ageMax).toBeNull();
    const back = filterToQuery(r);
    expect(back['cov']).toBe('health,care');
    expect(back['hireTo']).toBeNull();
    expect(filterFromQuery((k) => back[k] ?? null)).toEqual(r);
  });
  it('使っていない条件は null（URL から消す）', () => {
    expect(Object.values(filterToQuery(emptyFilter())).every((v) => v === null)).toBeTrue();
  });
});

describe('activeCount / needsContracts / toggle', () => {
  it('入社日の「いつから」「いつまで」で1つ、年齢の下限・上限で1つと数える', () => {
    expect(activeCount(f({ hireFrom: '2026-01-01', hireTo: '2026-12-31', ageMin: 40, sex: ['female'] }))).toBe(3);
  });
  it('区分・雇用形態を使うときだけ契約を読む', () => {
    expect(needsContracts(f({ sex: ['male'] }))).toBeFalse();
    expect(needsContracts(f({ employment: ['part'] }))).toBeTrue();
  });
  it('付け外し。並びは選択肢の順', () => {
    expect(toggle(['unknown'], 'regular', CATEGORY_OPTIONS)).toEqual(['regular', 'unknown']);
    expect(toggle(['regular', 'unknown'], 'regular', CATEGORY_OPTIONS)).toEqual(['unknown']);
  });
});

describe('matchesFilter', () => {
  it('同じ条件の中は「どれか」：健保か介護', () => {
    expect(matchesFilter(emp(), f({ coverage: ['care', 'health'] }), CTX)).toBeTrue();
    expect(matchesFilter(emp({ health: off, pension: off }), f({ coverage: ['health'] }), CTX)).toBeFalse();
    expect(matchesFilter(emp({ health: off, pension: off }), f({ coverage: ['none'] }), CTX)).toBeTrue();
  });
  it('違う条件どうしは「どれも」：女性 かつ 外国籍', () => {
    const x = f({ sex: ['female'], nationality: ['foreign'] });
    expect(matchesFilter(emp({ sex: 'female', foreign: {} as never }), x, CTX)).toBeTrue();
    expect(matchesFilter(emp({ sex: 'female' }), x, CTX)).toBeFalse();
  });
  it('入社日の範囲（両端を含む）', () => {
    const x = f({ hireFrom: '2024-04-01', hireTo: '2024-12-31' });
    expect(matchesFilter(emp(), x, CTX)).toBeTrue();
    expect(matchesFilter(emp({ hireDate: '2025-01-01' }), x, CTX)).toBeFalse();
  });
  it('年齢の範囲（今日の年齢。両端を含む）', () => {
    // 1990-05-15 生まれ → 2026-11-09 に36歳
    expect(matchesFilter(emp(), f({ ageMin: 36, ageMax: 36 }), CTX)).toBeTrue();
    expect(matchesFilter(emp(), f({ ageMin: 40 }), CTX)).toBeFalse();
  });
  it('性別の「未入力」', () => {
    expect(matchesFilter(emp({ sex: null }), f({ sex: ['unset'] }), CTX)).toBeTrue();
  });
  it('区分・雇用形態は、契約を読み終わるまで絞らない', () => {
    const x = f({ category: ['shortTime'], employment: ['part'] });
    expect(matchesFilter(emp(), x, CTX)).toBeTrue();
    expect(matchesFilter(emp(), x, { ...CTX, category: 'regular', employment: 'part' })).toBeFalse();
    expect(matchesFilter(emp(), x, { ...CTX, category: 'shortTime', employment: 'part' })).toBeTrue();
    expect(matchesFilter(emp(), x, { ...CTX, category: 'shortTime', employment: null })).toBeFalse();
  });
});
