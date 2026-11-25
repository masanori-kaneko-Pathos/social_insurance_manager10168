import type { GradeTableDoc } from '../../../core/models/rates';
import type { Employee } from '../../../core/models/employee';
import { HEALTH_ROWS, PENSION_ROWS } from '../../payrolls/logic/grades.fixture';
import { EMPLOYEE_CSV_HEADERS, employeeCsvTemplate, ImportContext, planImport, readEmployeeCsv, SkippedPerson } from './employee-csv';
import { employeeExportRow } from './employee-export';
import { changeTab, PersonChange, samePersonChanges, samePersonUpdate } from './same-person-import';

const TABLES = [
  { kind: 'health', from: '2024-03', grades: HEALTH_ROWS },
  { kind: 'pension', from: '2024-03', grades: PENSION_ROWS },
] as unknown as GradeTableDoc[];
const DEPTS = [
  { id: 'd1', name: '営業部' },
  { id: 'd2', name: '総務部' },
];
const BASE = {
  employeeNumber: 'E010', lastName: '山田', firstName: '太郎', lastNameKana: 'ヤマダ', firstNameKana: 'タロウ',
  birthDate: '1990-05-15', hireDate: '2026-04-01', employmentType: '正社員', payType: '月給',
  weeklyHours: '40:00', monthlyDays: '21', scheduledWage: '280000', expectedCash: '300000',
};
function table(...rows: Record<string, string>[]): string[][] {
  const [header] = employeeCsvTemplate();
  const keys = Object.keys(EMPLOYEE_CSV_HEADERS);
  return [header, ...rows.map((r) => keys.map((k) => r[k] ?? ''))];
}
const ctx = (existing: Record<string, string> | null): ImportContext => ({
  office: { standardHours: { weeklyMinutes: 2400, monthlyDays: 21 }, specificApplication: { since: null } },
  criteria: [{ from: '2026-10', weeklyMinutesMin: 1200, wageMin: null, reducedWageMin: 88000 }],
  gradeTables: TABLES,
  existingNumbers: new Set(existing ? [existing['employeeNumber']] : []),
  existingPeople: existing
    ? new Map([[existing['employeeNumber'], { lastName: existing['lastName'], firstName: existing['firstName'], birthDate: existing['birthDate'] }]])
    : undefined,
  departments: DEPTS,
});
const deptName = (id: string) => DEPTS.find((d) => d.id === id)?.name ?? null;

/** 登録済みの人（行 row を新しく取り込んだときの形）と、ファイルの行 file を取り込み直したときの、変更点と（初期値のまま）保存するもの */
function reimport(row: Record<string, string>, file: Record<string, string>) {
  const item = planImport(readEmployeeCsv(table(row)).rows, ctx(null)).items[0];
  const saved = { ...item.employee, id: 'x', leaves: item.leaves, userUid: null } as unknown as Employee & typeof item.employee;
  const s: SkippedPerson = planImport(readEmployeeCsv(table(file)).rows, ctx(row)).skipped[0];
  const fileEmployee = {
    ...saved,
    ...s.employee,
    health: { ...saved.health, enrolled: s.healthOverride ?? saved.health.enrolled },
    pension: { ...saved.pension, enrolled: s.pensionOverride ?? saved.pension.enrolled },
    leaves: [],
  } as Employee;
  const amount = item.remuneration ? [{ from: item.remuneration.from, reason: 'acquisition' as const, monthlyAmount: item.remuneration.monthlyAmount }] : [];
  const changes = samePersonChanges({
    values: s.values,
    fileRow: employeeExportRow(
      {
        employee: fileEmployee,
        contract: s.contract,
        remunerations: s.monthlyAmount != null ? [{ from: '', reason: 'acquisition', monthlyAmount: s.monthlyAmount }] : [],
        private: { contact: s.employee.contact, register: s.employee.register },
      },
      deptName,
    ),
    savedRow: employeeExportRow({ employee: saved, contract: item.contract, remunerations: amount, private: saved }, deptName),
    fileLeaves: s.leaves,
    savedLeaves: saved.leaves,
    savedRetired: !!saved.retireDate,
    departmentUnknown: s.departmentUnknown,
  });
  const fileSide = { employee: s.employee, leaves: s.leaves };
  const apply = (chosen: PersonChange[]) => samePersonUpdate(saved, fileSide, chosen);
  return { changes, update: apply(changes.filter((c) => c.apply)), apply };
}
/** 項目:登録→CSV:選べるか（初期値） */
const brief = (c: PersonChange[]) =>
  c.map((x) => `${x.item}:${x.saved}→${x.file}:${x.selectable ? (x.apply ? '変更する' : '変更しない') : 'リンク'}`);

describe('CSVによる変更点（11/25）', () => {
  it('部署：登録と違えば初期値「変更する」。空なら埋める', () => {
    const moved = reimport({ ...BASE, department: '営業部' }, { ...BASE, department: '総務部' });
    expect(brief(moved.changes)).toEqual(['department:営業部→総務部:変更する']);
    expect(moved.update?.patch.org?.departmentId).toBe('d2');
    const first = reimport(BASE, { ...BASE, department: ' 営業部' });
    expect(brief(first.changes)).toEqual(['department:→営業部:変更する']);
  });
  it('部署の欄が空なら比べない。設定にない部署名は選べない', () => {
    expect(reimport({ ...BASE, department: '営業部' }, BASE).changes).toEqual([]);
    const unknown = reimport({ ...BASE, department: '営業部' }, { ...BASE, department: '開発部' });
    expect(brief(unknown.changes)).toEqual(['department:営業部→開発部:リンク']);
    expect(unknown.changes[0].unknownDepartment).toBeTrue();
    expect(unknown.update).toBeNull();
  });
  it('入力済みの値と違う項目は、初期値「変更しない」。選べば変更する（部署と一緒でも、役職はそのまま）', () => {
    const r = reimport(
      { ...BASE, department: '営業部', jobType: '営業', insuredNumber: '15' },
      { ...BASE, department: '総務部', jobType: '経理', insuredNumber: '51' },
    );
    expect(brief(r.changes)).toEqual(['insuredNumber:15→51:変更しない', 'department:営業部→総務部:変更する', 'jobType:営業→経理:変更しない']);
    expect(r.update?.patch).toEqual({ org: jasmine.objectContaining({ departmentId: 'd2', jobType: '営業' }) });
    const all = r.apply(r.changes);
    expect(all?.patch.insuredNumber).toBe('51');
    expect(all?.patch.org).toEqual(jasmine.objectContaining({ departmentId: 'd2', jobType: '経理' }));
    expect(all?.count).toBe(3);
  });
  it('整理番号・基礎年金番号は空なら初期値「変更する」', () => {
    const r = reimport(BASE, { ...BASE, insuredNumber: '15', basicPensionNumber: '1234567890' });
    expect(brief(r.changes)).toEqual(['basicPensionNumber:→1234567890:変更する', 'insuredNumber:→15:変更する']);
    expect(r.update?.patch).toEqual({ basicPensionNumber: '1234567890', insuredNumber: '15' });
  });
  it('国籍・ローマ字：外国籍の情報がまだない人は、1行にまとめて選べる', () => {
    const p = { ...BASE, lastName: 'NGUYEN', firstName: 'VAN', lastNameKana: 'グエン', firstNameKana: 'ヴァン' };
    const r = reimport(p, { ...p, nationality: 'VN', romanLastName: 'Nguyen', romanFirstName: 'Van' });
    expect(brief(r.changes)).toEqual(['foreign:→VN NGUYEN VAN:変更する']);
    expect(r.update?.patch.foreign?.nationality).toBe('VN');
  });
  it('計算に効く項目（契約・加入・報酬月額）は選べない。休業は足せる', () => {
    const r = reimport(BASE, {
      ...BASE,
      scheduledWage: '300000',
      healthEnrolled: 'いいえ',
      monthlyAmount: '320000',
      leave1Kind: '育休', leave1Start: '2026-05-10', leave1End: '2027-03-31', leave1Birth: '2026-03-15',
    });
    expect(brief(r.changes)).toEqual([
      'healthEnrolled:はい→いいえ:リンク',
      'monthlyAmount:300000→320000:リンク',
      'scheduledWage:280000→300000:リンク',
      'leave:→育休 2026-05-10〜2027-03-31:変更する',
    ]);
    expect(r.update?.leaves?.map((l) => l.start)).toEqual(['2026-05-10']);
    expect(r.update?.followUps).toEqual(['childcare']);
  });
  it('性別：登録が空なら選べる。登録と違えば編集画面へ（厚生年金の種別に関わるため）', () => {
    expect(brief(reimport(BASE, { ...BASE, sex: '女' }).changes)).toEqual(['sex:→女:変更する']);
    expect(brief(reimport({ ...BASE, sex: '男' }, { ...BASE, sex: '女' }).changes)).toEqual(['sex:男→女:リンク']);
  });
  it('関連する届出：住所・カナを入力済みの値から変えたとき。初めて入れるときは出さない', () => {
    const first = reimport(BASE, { ...BASE, postalCode: '1000001', address: '東京都千代田区1-1' });
    expect(first.changes.map((c) => c.followUp)).toEqual([null, null]);
    const moved = reimport(
      { ...BASE, postalCode: '1000001', address: '東京都千代田区1-1' },
      { ...BASE, postalCode: '1500001', address: '東京都渋谷区1-1', lastNameKana: 'ヤマモト' },
    );
    expect(moved.changes.map((c) => `${c.item}:${c.followUp}`)).toEqual(['lastNameKana:name', 'postalCode:address', 'address:address']);
    const all = moved.apply(moved.changes)!;
    expect(all.followUps).toEqual(['name', 'address', 'address']);
    expect(all.patch.contact).toEqual(jasmine.objectContaining({ postalCode: '1500001', address: '東京都渋谷区1-1' }));
    expect(all.patch.lastNameKana).toBe('ヤマモト');
  });
  it('言い方が違うだけ（男／男性、全角の数字）は違いにしない。CSVの空の列は比べない', () => {
    expect(reimport({ ...BASE, sex: '男' }, { ...BASE, sex: '男性', scheduledWage: '２８００００', department: '' }).changes).toEqual([]);
  });
  it('選べない行の行き先：契約・休業は雇用・契約、加入は加入と保険料、報酬月額は給与と標準報酬、ほかは編集', () => {
    expect(changeTab('scheduledWage')).toBe('employment');
    expect(changeTab('healthEnrolled')).toBe('insurance');
    expect(changeTab('monthlyAmount')).toBe('pay');
    expect(changeTab('sex')).toBeNull();
  });
});
