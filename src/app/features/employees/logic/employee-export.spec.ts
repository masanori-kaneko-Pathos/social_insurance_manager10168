import type { Contract } from '../../../core/models/contract';
import { emptyLeave, Employee } from '../../../core/models/employee';
import { readEmployeeCsv } from './employee-csv';
import { employeeExportTable, hoursText } from './employee-export';

const on = (d: string) => ({ enrolled: true, acquiredDate: d, lostDate: null, lossReason: null });
const emp = (p: Partial<Employee> = {}) =>
  ({
    id: 'e1',
    employeeNumber: 'E001',
    lastName: '山田',
    firstName: '太郎',
    lastNameKana: 'ヤマダ',
    firstNameKana: 'タロウ',
    birthDate: '1990-05-15',
    sex: 'male',
    hireDate: '2026-04-01',
    retireDate: null,
    retireReason: null,
    health: on('2026-04-01'),
    pension: on('2026-04-01'),
    optInDate: null,
    optOutDate: null,
    insuredNumber: '123',
    basicPensionNumber: '1234567890',
    foreign: null,
    leaves: [],
    org: { departmentId: 'd1', position: null, officer: null },
    ...p,
  }) as Employee;

const contract: Contract = {
  from: '2026-04-01',
  employmentType: 'part',
  payType: 'hourly',
  weeklyMinutes: 1230,
  monthlyDays: 12,
  scheduledWage: 104000,
  expectedCash: 110000,
  expectedInKind: 0,
  hourlyWage: 1200,
  dailyWage: null,
  periodEnd: '2027-03-31', // 期間の定めがあるときだけ、更新の見込みが意味を持つ
  renewal: 'possible',
  student: 'none',
  minimumWageReduction: false,
  dispatch: 'none' as Contract['dispatch'],
  specialEmployment: 'none',
  renewalPrecedent: false,
  noExtensionAgreed: false,
  note: null,
};

describe('employeeExportTable（従業員データの書き出し）', () => {
  it('分 → 時間の書き方', () => {
    expect(hoursText(2400)).toBe('40:00');
    expect(hoursText(1230)).toBe('20:30');
  });

  it('取り込みと同じ見出し・書き方で、そのまま取り込みで読める（往復）', () => {
    const leave = { ...emptyLeave('childcare', '2026-06-01'), plannedEnd: '2027-05-31', childBirthDate: '2026-04-05' };
    const table = employeeExportTable(
      [
        {
          employee: emp({ leaves: [leave] }),
          contract,
          remunerations: [
            { from: '2026-04', reason: 'acquisition', monthlyAmount: 110000 },
            { from: '2026-09', reason: 'regular', monthlyAmount: 120000 },
          ],
        },
      ],
      (id) => (id === 'd1' ? '総務部' : null),
    );
    const read = readEmployeeCsv(table);
    expect(read.missingColumns).toEqual([]);
    const row = read.rows[0];
    expect(row.errors).toEqual([]);
    const p = row.parsed!;
    expect(p.employee.lastName).toBe('山田');
    expect(p.contract.employmentType).toBe('part');
    expect(p.contract.weeklyMinutes).toBe(1230);
    expect(p.contract.renewal).toBe('possible');
    expect(p.contract.periodEnd).toBe('2027-03-31');
    expect(p.monthlyAmount).toBe(110000); // 資格取得時決定の記録
    expect(p.remunerationFrom).toBe('2026-04');
    expect(p.leaves.map((l) => [l.kind, l.start, l.plannedEnd])).toEqual([['childcare', '2026-06-01', '2027-05-31']]);
    expect(p.leaves[0].filed).toBeNull(); // 申出がまだの休業は「未申出」で出て、取り込むと申出がまだに戻る（11/19）
    expect(row.values.department).toBe('総務部');
    expect(row.values.myNumber).toBe(''); // マイナンバーは書き出さない
  });

  it('契約がない人・退職した人', () => {
    const table = employeeExportTable(
      [{ employee: emp({ retireDate: '2026-10-31', retireReason: 'resign' }), contract: null, remunerations: [] }],
      () => null,
    );
    const header = table[0];
    const row = table[1];
    expect(row[header.indexOf('退職の理由')]).toBe('退職');
    expect(row[header.indexOf('雇用形態')]).toBe('');
    expect(row[header.indexOf('部署')]).toBe('');
  });
});
