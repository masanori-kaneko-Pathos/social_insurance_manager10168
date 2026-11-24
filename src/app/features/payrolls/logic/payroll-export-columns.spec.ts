import { Payroll } from '../../../core/models/payroll';
import { exportTable, picksOf } from '../../../shared/export/export-table';
import { buildPayrollCsv, PAYROLL_COLUMNS, payrollExportRows } from './payroll-csv';
import { PayrollExportEmployee, payrollExportColumns } from './payroll-export-columns';

const emp = (id: string, no: string, over: Partial<PayrollExportEmployee> = {}): PayrollExportEmployee =>
  ({ id, employeeNumber: no, lastName: '山田', firstName: id, hireDate: '2020-04-01', retireDate: null, ...over }) as unknown as PayrollExportEmployee;

const pay = (employeeId: string, paidMonth: string, over: Partial<Payroll> = {}): Payroll =>
  ({
    officeId: 'o', employeeId, paidMonth, cash: 300000, fixed: 280000, days: 31, inKind: 0, retro: 0,
    state: 'normal', ...over,
  }) as Payroll;

describe('給与の目録（項目を選んで出力。11/24）', () => {
  const employees = [emp('a', '0001', { lastNameKana: 'ヤマダ', firstNameKana: 'エー', org: { departmentId: 'd1' } }), emp('b', '0002')];
  const payrolls = [pay('a', '2026-09', { inKind: 12000, retro: 5000 }), pay('b', '2026-09', { inKind: null }), pay('a', '2026-10')];
  const months = ['2026-09', '2026-10'];
  const schedule = { closingDay: 31, payDay: 25, payMonth: 'next' } as never;

  for (const lang of ['ja', 'en'] as const) {
    it(`標準の形は、今までの CSV と同じ（${lang}・未入力の月は数字の欄が空）`, () => {
      const catalog = payrollExportColumns({ lang, t: (k) => k, deptName: () => '' });
      const rows = payrollExportRows(employees, payrolls, months, schedule);
      expect(exportTable(rows, catalog, picksOf(PAYROLL_COLUMNS))).toEqual(
        buildPayrollCsv(employees, payrolls, months, schedule, lang),
      );
    });
  }

  it('足した項目：フリガナ・部署・報酬の合計（支払額＋現物。内訳なしは支払額だけ）', () => {
    const catalog = payrollExportColumns({ lang: 'ja', t: (k) => k, deptName: (id) => (id === 'd1' ? '総務部' : '') });
    const rows = payrollExportRows(employees, payrolls, months, schedule);
    const table = exportTable(rows, catalog, picksOf(['employeeNumber', 'paidMonth', 'kana', 'department', 'payTotal']));
    expect(table).toEqual([
      ['社員番号', '支払月', 'exportCols.payroll.kana', 'exportCols.payroll.department', 'exportCols.payroll.payTotal'],
      ['0001', '2026-09', 'ヤマダ エー', '総務部', '312000'],
      ['0002', '2026-09', '', '', '300000'],
      ['0001', '2026-10', 'ヤマダ エー', '総務部', '300000'],
      ['0002', '2026-10', '', '', ''],
    ]);
  });
});
