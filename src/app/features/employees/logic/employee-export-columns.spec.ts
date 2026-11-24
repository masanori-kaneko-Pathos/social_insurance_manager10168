import { exportTable, picksOf } from '../../../shared/export/export-table';
import { Employee } from '../../../core/models/employee';
import { EMPLOYEE_DEFAULT_KEYS, employeeExportColumns } from './employee-export-columns';
import { EmployeeExportItem, employeeExportTable } from './employee-export';
import { EMPLOYEE_COLUMNS } from './employee-csv';

const employee = {
  id: 'e1',
  employeeNumber: '0001',
  lastName: '山田',
  firstName: '太郎',
  lastNameKana: 'ヤマダ',
  firstNameKana: 'タロウ',
  birthDate: '1990-05-15',
  sex: 'male',
  hireDate: '2024-04-01',
  retireDate: null,
  health: { enrolled: true, acquiredDate: '2024-04-01', lostDate: null },
  pension: { enrolled: true, acquiredDate: '2024-04-01', lostDate: null },
  leaves: [],
  org: { departmentId: 'd1' },
} as unknown as Employee;
const item: EmployeeExportItem = {
  employee,
  contract: null,
  remunerations: [
    { from: '2024-04', reason: 'acquisition', monthlyAmount: 300000, health: { grade: 22, standard: 300000 }, pension: { grade: 19, standard: 300000 } },
    { from: '2025-09', reason: 'regular', monthlyAmount: 320000, health: { grade: 23, standard: 320000 }, pension: { grade: 20, standard: 320000 } },
  ] as unknown as EmployeeExportItem['remunerations'],
};
const dept = (id: string) => (id === 'd1' ? '総務部' : null);

describe('従業員一覧の目録（項目を選んで出力。11/24）', () => {
  const catalog = employeeExportColumns({ t: (k) => k, deptName: dept, asOf: '2026-11-24' });

  it('標準の形は、今までの書き出しからマイナンバーの列を除いたもの（見出し・値とも同じ）', () => {
    const old = employeeExportTable([item], dept);
    const keep = EMPLOYEE_COLUMNS.map((k, i) => [k, i] as const).filter(([k]) => k !== 'myNumber').map(([, i]) => i);
    const expected = old.map((row) => keep.map((i) => row[i]));
    expect(exportTable([item], catalog, picksOf(EMPLOYEE_DEFAULT_KEYS))).toEqual(expected);
  });

  it('足した項目：基準日の年齢と、その月の標準報酬月額', () => {
    const t = exportTable([item], catalog, picksOf(['age', 'healthStandardNow', 'pensionStandardNow']));
    expect(t[1]).toEqual(['36', '320000', '320000']);
  });

  it('マイナンバーは目録にない', () => {
    expect(catalog.some((c) => c.key === 'myNumber')).toBeFalse();
  });
});
