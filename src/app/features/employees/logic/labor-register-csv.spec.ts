import type { GradeTableDoc } from '../../../core/models/rates';
import type { Employee } from '../../../core/models/employee';
import { HEALTH_ROWS, PENSION_ROWS } from '../../payrolls/logic/grades.fixture';
import { EMPLOYEE_CSV_HEADERS, employeeCsvTemplate, ImportContext, planImport, readEmployeeCsv } from './employee-csv';
import { employeeExportTable } from './employee-export';

// 労働者名簿の4項目（住所・業務の種類・履歴・退職の事由の内容）を、従業員の CSV で読み書きする（11/24）

const TABLES = [
  { kind: 'health', from: '2024-03', grades: HEALTH_ROWS },
  { kind: 'pension', from: '2024-03', grades: PENSION_ROWS },
] as unknown as GradeTableDoc[];

const CTX: ImportContext = {
  office: { standardHours: { weeklyMinutes: 2400, monthlyDays: 21 }, specificApplication: { since: null } },
  criteria: [{ from: '2026-10', weeklyMinutesMin: 1200, wageMin: null, reducedWageMin: 88000 }],
  gradeTables: TABLES,
  existingNumbers: new Set(),
  departments: [{ id: 'd1', name: '営業部' }],
};

function table(...rows: Record<string, string>[]): string[][] {
  const [header] = employeeCsvTemplate();
  const keys = Object.keys(EMPLOYEE_CSV_HEADERS);
  return [header, ...rows.map((r) => keys.map((k) => r[k] ?? ''))];
}

const BASE = {
  employeeNumber: 'E010', lastName: '山田', firstName: '太郎', lastNameKana: 'ヤマダ', firstNameKana: 'タロウ',
  birthDate: '1990-05-15', hireDate: '2020-04-01', employmentType: '正社員', payType: '月給',
  weeklyHours: '40:00', monthlyDays: '21', scheduledWage: '280000', expectedCash: '300000',
};

describe('従業員の CSV：労働者名簿の項目（11/24）', () => {
  it('郵便番号・住所・業務の種類・履歴（セルの中の改行）を読む', () => {
    const r = readEmployeeCsv(
      table({
        ...BASE,
        postalCode: '100-0001',
        address: '東京都千代田区千代田1-1',
        jobType: '法人営業',
        history: '2018-04 ○○商事 入社（前職）\n2020/4 入社 総務部\r\n2024年4月 営業部へ異動',
      }),
    );
    expect(r.rows[0].errors).toEqual([]);
    const e = r.rows[0].parsed!.employee;
    expect(e.contact.postalCode).toBe('1000001');
    expect(e.contact.address).toBe('東京都千代田区千代田1-1');
    expect(e.org?.jobType).toBe('法人営業');
    expect(e.register.history).toEqual([
      { month: '2018-04', text: '○○商事 入社（前職）' },
      { month: '2020-04', text: '入社 総務部' },
      { month: '2024-04', text: '営業部へ異動' },
    ]);
    expect(e.register.retireDetail).toBeNull();
  });

  it('退職の理由の列に、名簿の「事由」の文が入っていても読む（解雇 ＋ 理由を内容に残す）', () => {
    const r = readEmployeeCsv(table({ ...BASE, retireDate: '2026-09-30', retireReason: '懲戒解雇（無断欠勤が続いたため）' }));
    expect(r.rows[0].errors).toEqual([]);
    const e = r.rows[0].parsed!.employee;
    expect(e.retireReason).toBe('dismissal');
    expect(e.register.retireDetail).toBe('懲戒解雇（無断欠勤が続いたため）');
  });

  it('事由の内容の列があれば、そちらを使う。退職日がなければ消す', () => {
    const a = readEmployeeCsv(table({ ...BASE, retireDate: '2026-09-30', retireReason: '死亡', retireDetail: '病死' }));
    expect(a.rows[0].parsed!.employee.retireReason).toBe('death');
    expect(a.rows[0].parsed!.employee.register.retireDetail).toBe('病死');
    const b = readEmployeeCsv(table({ ...BASE, retireDetail: '病死' }));
    expect(b.rows[0].parsed!.employee.register.retireDetail).toBeNull();
  });

  it('郵便番号の形・履歴の行数はエラー', () => {
    const r = readEmployeeCsv(
      table({ ...BASE, postalCode: '12-345', history: Array.from({ length: 31 }, (_, i) => `行${i}`).join('\n') }),
    );
    expect(r.rows[0].errors).toEqual([
      { column: 'postalCode', code: 'postalCode' },
      { column: 'history', code: 'historyTooMany' },
    ]);
  });

  it('部署を結んでも、業務の種類は消えない', () => {
    const plan = planImport(readEmployeeCsv(table({ ...BASE, department: '営業部', jobType: '法人営業' })).rows, CTX);
    expect(plan.items[0].employee.org).toEqual({ departmentId: 'd1', position: null, officer: null, jobType: '法人営業' });
  });

  it('書き出したものを読み直すと、同じ値に戻る（住所・業務の種類・履歴・事由の内容）', () => {
    const r = readEmployeeCsv(
      table({
        ...BASE,
        postalCode: '1000001',
        address: '東京都千代田区千代田1-1',
        jobType: '法人営業',
        history: '2020-04 入社 総務部\n2024-04 営業部へ異動',
        retireDate: '2026-09-30',
        retireReason: '解雇',
        retireDetail: '業績不振による整理解雇',
      }),
    );
    const input = r.rows[0].parsed!.employee;
    const employee = { id: 'x', ...input, leaves: [] } as unknown as Employee;
    const out = employeeExportTable(
      [{ employee, contract: null, remunerations: [], private: { contact: input.contact, register: input.register } }],
      () => null,
    );
    const again = readEmployeeCsv(out).rows[0];
    // 契約の列は空なので、名簿の列だけ見る
    const cols = ['postalCode', 'address', 'jobType', 'history', 'retireReason', 'retireDetail'] as const;
    expect(cols.map((c) => again.values[c])).toEqual(['1000001', '東京都千代田区千代田1-1', '法人営業', '2020-04 入社 総務部\n2024-04 営業部へ異動', '解雇', '業績不振による整理解雇']);
  });
});
