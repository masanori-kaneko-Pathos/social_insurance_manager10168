import type { GradeTableDoc } from '../../../core/models/rates';
import type { Classification } from '../../employees/logic/classify';
import { HEALTH_ROWS, PENSION_ROWS } from '../../payrolls/logic/grades.fixture';
import {
  ActionContract,
  ActionPerson,
  actionErrors,
  actionFor,
  actionForm,
  autoGrades,
  buildSave,
} from './todo-actions';
import { ageItems, BoardItem, todoItem } from './todo-board';
import { Todo, TodoKind } from './todos';

const TODAY = '2026-11-10';
const TABLES: GradeTableDoc[] = [
  { kind: 'health', from: '2024-03', grades: HEALTH_ROWS, source: 'test' },
  { kind: 'pension', from: '2024-03', grades: PENSION_ROWS, source: 'test' },
];
const C = (category: Classification['category']): Classification => ({
  category,
  reason: 'threeQuarters',
  contractFrom: null,
  below: null,
  nums: null,
});
const off = { enrolled: false, acquiredDate: null, lostDate: null, lossReason: null };
const on = (d: string) => ({ enrolled: true, acquiredDate: d, lostDate: null, lossReason: null });

function person(p: Partial<ActionPerson> = {}): ActionPerson {
  return {
    id: 'T04',
    birthDate: '1990-05-15',
    hireDate: '2026-04-01',
    retireDate: null,
    health: off,
    pension: off,
    certificate: null,
    ...p,
  };
}
const CONTRACTS: ActionContract[] = [{ from: '2026-04-01', expectedCash: 104000, expectedInKind: 0 }];
const item = (kind: TodoKind, date: string | null, next: Classification | null = null): BoardItem =>
  todoItem({ kind, employeeId: 'T04', today: C('shortTime'), date, next } as Todo);

describe('actionFor：どの窓を開くか', () => {
  it('資格取得届：To-do の「いつから」が取得日。見込みの報酬は契約から', () => {
    const r = actionFor(item('acquire', '2026-10-01'), person(), CONTRACTS, TODAY)!;
    expect(r.mode).toBe('acquire');
    expect(r.date).toBe('2026-10-01');
    expect(r.plans).toEqual({ health: true, pension: true });
    expect(r.expected).toBe(104000);
  });
  it('これから加入（T12）：変わる日で取得届の窓', () => {
    const r = actionFor(item('upcoming', '2026-11-20', C('regular')), person(), CONTRACTS, TODAY)!;
    expect([r.mode, r.date]).toEqual(['acquire', '2026-11-20']);
  });
  it('これから外れる：変わる日で喪失届の窓（入っている保険だけ）', () => {
    const p = person({ health: on('2026-04-01'), pension: on('2026-04-01') });
    const r = actionFor(item('upcoming', '2026-12-01', C('excluded')), p, CONTRACTS, TODAY)!;
    expect([r.mode, r.date, r.reason]).toEqual(['loss', '2026-12-01', 'retire']);
    expect(r.plans).toEqual({ health: true, pension: true });
  });
  it('70歳以上は厚年を取得できない', () => {
    const p = person({ birthDate: '1955-01-10' }); // 70歳到達 2025-01-09
    const r = actionFor(item('acquire', '2026-10-01'), p, CONTRACTS, TODAY)!;
    expect(r.plans).toEqual({ health: true, pension: false });
  });
  it('協定（年金だけ）：厚年だけを喪失。証明書が取得日より前からなら取得日', () => {
    const p = person({
      health: on('2026-04-01'),
      pension: on('2026-04-01'),
      certificate: { country: 'US', from: '2026-03-01', to: '2029-02-28', covers: 'pension' },
    });
    const r = actionFor(item('agreement', '2026-03-01'), p, CONTRACTS, TODAY)!;
    expect([r.mode, r.date, r.reason]).toEqual(['loss', '2026-04-01', 'agreement']);
    expect(r.plans).toEqual({ health: false, pension: true });
  });
  it('区分変更届：確認済みの鍵つき', () => {
    const r = actionFor(item('categoryChange', '2026-12-01'), person(), CONTRACTS, TODAY)!;
    expect([r.mode, r.dismissKey]).toEqual(['category', 'categoryChange:T04:2026-12-01']);
  });
  it('75歳：健保だけ、喪失日は誕生日、原因は75歳到達', () => {
    const p = person({ birthDate: '1951-12-05', hireDate: '2018-04-01', health: on('2018-04-01') });
    const [age] = ageItems([{ ...p, retireDate: null }], '2026-12', '2026-12', TODAY);
    const r = actionFor(age, p, CONTRACTS, TODAY)!;
    expect([r.mode, r.date, r.reason, r.dismissKey]).toEqual(['loss', '2026-12-05', 'age75', 'age:T04:75']);
    expect(r.plans).toEqual({ health: true, pension: false });
  });
  it('40歳などは窓がない（確認しただけ）', () => {
    const p = person({ birthDate: '1986-11-20', health: on('2026-04-01') });
    const [age] = ageItems([{ ...p, retireDate: null }], '2026-11', '2026-11', TODAY);
    expect(actionFor(age, p, CONTRACTS, TODAY)).toBeNull();
  });
});

describe('autoGrades', () => {
  it('104,000円 → 健保6級・厚年3級', () => {
    expect(autoGrades(TABLES, '2026-10-01', '104000')).toEqual({ health: '6', pension: '3' });
  });
  it('金額が読めなければ空', () => {
    expect(autoGrades(TABLES, '2026-10-01', 'x')).toEqual({ health: '', pension: '' });
  });
});

describe('actionErrors', () => {
  const r = actionFor(item('acquire', '2026-10-01'), person(), CONTRACTS, TODAY)!;
  const ok = { ...actionForm(r, TODAY), healthGrade: '6', pensionGrade: '3' };
  it('そろっていればエラーなし', () => {
    expect(actionErrors(ok, r, person(), TABLES)).toEqual({});
  });
  it('入社日より前の取得日・報酬月額なし・保険を選んでいない', () => {
    const e = actionErrors({ ...ok, date: '2026-03-31', amount: '', health: false, pension: false }, r, person(), TABLES);
    expect(e).toEqual({ date: 'beforeHire', amount: 'amount', health: 'noPlan' });
  });
  it('等級表にない等級', () => {
    expect(actionErrors({ ...ok, pensionGrade: '99' }, r, person(), TABLES).healthGrade).toBe('grade');
  });
  it('喪失日が取得日以前', () => {
    const p = person({ health: on('2026-04-01'), pension: on('2026-04-01') });
    const lr = actionFor(item('lose', null), p, CONTRACTS, TODAY)!;
    const e = actionErrors({ ...actionForm(lr, TODAY), date: '2026-04-01' }, lr, p, TABLES);
    expect(e.date).toBe('beforeAcquired');
  });
});

describe('buildSave', () => {
  it('取得届：加入にして、取得月の標準報酬（資格取得時決定）と届出の記録', () => {
    const r = actionFor(item('acquire', '2026-10-01'), person(), CONTRACTS, TODAY)!;
    const v = { ...actionForm(r, TODAY), healthGrade: '6', pensionGrade: '3' };
    const s = buildSave(v, r, person(), TABLES, [])!;
    expect(s.enrollment?.health).toEqual({ enrolled: true, acquiredDate: '2026-10-01', lostDate: null, lossReason: null });
    expect(s.remuneration).toEqual({
      from: '2026-10',
      reason: 'acquisition',
      monthlyAmount: 104000,
      health: { grade: 6, standard: 104000 },
      pension: { grade: 3, standard: 104000 },
    });
    expect(s.filing).toEqual({ type: 'acquisition', subject: '2026-10-01', submittedOn: TODAY });
  });
  it('その月の標準報酬がもうあれば上書きしない', () => {
    const r = actionFor(item('acquire', '2026-10-01'), person(), CONTRACTS, TODAY)!;
    const v = { ...actionForm(r, TODAY), healthGrade: '6', pensionGrade: '3' };
    expect(buildSave(v, r, person(), TABLES, ['2026-10'])!.remuneration).toBeNull();
  });
  it('喪失届：選んだ保険だけ喪失日と原因。提出日が空なら null', () => {
    const p = person({ health: on('2026-04-01'), pension: on('2026-04-01') });
    const r = actionFor(item('upcoming', '2026-12-01', C('excluded')), p, CONTRACTS, TODAY)!;
    const v = { ...actionForm(r, TODAY), health: false, submittedOn: '' };
    const s = buildSave(v, r, p, TABLES, [])!;
    expect(s.enrollment?.health).toEqual(on('2026-04-01'));
    expect(s.enrollment?.pension).toEqual({ enrolled: true, acquiredDate: '2026-04-01', lostDate: '2026-12-01', lossReason: 'retire' });
    expect(s.filing).toEqual({ type: 'loss', subject: '2026-12-01', submittedOn: null });
  });
  it('区分変更届：従業員の文書は書かない', () => {
    const r = actionFor(item('categoryChange', '2026-12-01'), person(), CONTRACTS, TODAY)!;
    const s = buildSave(actionForm(r, TODAY), r, person(), TABLES, [])!;
    expect(s.enrollment).toBeNull();
    expect(s.filing.type).toBe('category');
  });
});
