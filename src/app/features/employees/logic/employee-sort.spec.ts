import type { Employee } from '../../../core/models/employee';
import { sortEmployees } from './employee-sort';

const on = (d: string) => ({ enrolled: true, acquiredDate: d, lostDate: null, lossReason: null });

function emp(p: Partial<Employee>): Employee {
  return {
    employeeNumber: null, lastName: '', firstName: '', lastNameKana: 'ア', firstNameKana: 'ア', nameOrder: 'kana', foreign: null,
    birthDate: '1990-01-01', hireDate: '2020-04-01', health: on('2020-04-01'), pension: on('2020-04-01'),
    ...p,
  } as Employee;
}

const A = emp({ employeeNumber: 'T2', lastNameKana: 'サトウ', birthDate: '1990-05-01', hireDate: '2024-04-01' });
const B = emp({ employeeNumber: 'T10', lastNameKana: 'アオキ', birthDate: '1980-05-01', hireDate: '2020-04-01' });
const C = emp({ employeeNumber: null, lastNameKana: 'カトウ', birthDate: '2000-05-01', hireDate: '2026-04-01' });
const nums = (l: Employee[]) => l.map((e) => e.lastNameKana);

describe('sortEmployees', () => {
  it('氏名（カナ）の順と逆順', () => {
    expect(nums(sortEmployees([A, B, C], 'name', 'asc'))).toEqual(['アオキ', 'カトウ', 'サトウ']);
    expect(nums(sortEmployees([A, B, C], 'name', 'desc'))).toEqual(['サトウ', 'カトウ', 'アオキ']);
  });
  it('社員番号は数字として比べる（T2 → T10）。番号がない人は向きに関係なく最後', () => {
    expect(nums(sortEmployees([B, C, A], 'number', 'asc'))).toEqual(['サトウ', 'アオキ', 'カトウ']);
    expect(nums(sortEmployees([B, C, A], 'number', 'desc'))).toEqual(['アオキ', 'サトウ', 'カトウ']);
  });
  it('年齢の若い順が昇順', () => {
    expect(nums(sortEmployees([A, B, C], 'age', 'asc'))).toEqual(['カトウ', 'サトウ', 'アオキ']);
  });
  it('入社日の古い順が昇順', () => {
    expect(nums(sortEmployees([A, B, C], 'hire', 'asc'))).toEqual(['アオキ', 'サトウ', 'カトウ']);
  });
  it('同じ値なら氏名の順', () => {
    const D = emp({ lastNameKana: 'イトウ', hireDate: '2020-04-01' });
    expect(nums(sortEmployees([B, D], 'hire', 'asc'))).toEqual(['アオキ', 'イトウ']);
  });
});
