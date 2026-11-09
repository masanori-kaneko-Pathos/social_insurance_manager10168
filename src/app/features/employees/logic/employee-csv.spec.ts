import type { GradeTableDoc } from '../../../core/models/rates';
import { HEALTH_ROWS, PENSION_ROWS } from '../../payrolls/logic/grades.fixture';
import {
  EMPLOYEE_CSV_HEADERS,
  employeeCsvTemplate,
  ImportContext,
  planImport,
  readDate,
  readEmployeeCsv,
} from './employee-csv';

const TABLES = [
  { kind: 'health', from: '2024-03', grades: HEALTH_ROWS },
  { kind: 'pension', from: '2024-03', grades: PENSION_ROWS },
] as unknown as GradeTableDoc[];

const CTX: ImportContext = {
  office: { standardHours: { weeklyMinutes: 2400, monthlyDays: 21 }, specificApplication: { since: null } },
  criteria: [{ from: '2026-10', weeklyMinutesMin: 1200, wageMin: null, reducedWageMin: 88000 }],
  gradeTables: TABLES,
  existingNumbers: new Set(),
};

/** ひな形の見出しで、1行だけ差し替えた表 */
function table(...rows: Record<string, string>[]): string[][] {
  const [header] = employeeCsvTemplate();
  const keys = Object.keys(EMPLOYEE_CSV_HEADERS);
  return [header, ...rows.map((r) => keys.map((k) => r[k] ?? ''))];
}
const BASE = {
  employeeNumber: 'E010', lastName: '山田', firstName: '太郎', lastNameKana: 'ヤマダ', firstNameKana: 'タロウ',
  birthDate: '1990-05-15', hireDate: '2026-04-01', employmentType: '正社員', payType: '月給',
  weeklyHours: '40:00', monthlyDays: '21', scheduledWage: '280000', expectedCash: '300000',
};

describe('readDate', () => {
  it('ハイフン・スラッシュ・全角を読む。ない日は読めない', () => {
    expect(readDate('2026/4/1')).toBe('2026-04-01');
    expect(readDate('２０２６－０４－０１')).toBe('2026-04-01');
    expect(readDate('2026-02-30')).toBeUndefined();
    expect(readDate('')).toBe('');
  });
});

describe('readEmployeeCsv', () => {
  it('ひな形の2行はそのまま読める', () => {
    const r = readEmployeeCsv(employeeCsvTemplate());
    expect(r.missingColumns).toEqual([]);
    expect(r.rows.map((x) => x.errors)).toEqual([[], []]);
    const part = r.rows[1].parsed!;
    expect(part.contract.payType).toBe('hourly');
    expect(part.contract.weeklyMinutes).toBe(1200);
    expect(part.contract.expectedCash).toBe(104000); // 空なら所定内賃金を写す
    expect(part.contract.from).toBe('2026-10-01'); // 契約は入社日から
  });
  it('必須の列がなければ、どの列がないかを返す', () => {
    const r = readEmployeeCsv([['社員番号', '姓'], ['E1', '山田']]);
    expect(r.missingColumns).toContain('birthDate');
  });
  it('見出しは列の名前（英語）でもよい', () => {
    const keys = Object.keys(EMPLOYEE_CSV_HEADERS);
    const r = readEmployeeCsv([keys, keys.map((k) => (BASE as Record<string, string>)[k] ?? '')]);
    expect(r.rows[0].errors).toEqual([]);
  });
  it('エラーは列ごとに出す（日付・選択肢・カナ・時給の欄）', () => {
    const r = readEmployeeCsv(
      table({ ...BASE, birthDate: '1990-13-01', employmentType: '社長', lastNameKana: 'やまだ', payType: '時給' }),
    );
    const codes = r.rows[0].errors.map((e) => `${e.column}:${e.code}`);
    expect(codes).toContain('birthDate:date');
    expect(codes).toContain('employmentType:choice');
    expect(codes).toContain('lastNameKana:kana');
    expect(codes).toContain('hourlyWage:contract.wage');
    expect(r.rows[0].parsed).toBeNull();
  });
  it('休業は2件まで。産休の出産日・育休の子の生年月日を入れる', () => {
    const r = readEmployeeCsv(
      table({
        ...BASE,
        leave1Kind: '産休', leave1Start: '2026-08-01', leave1End: '2026-11-10', leave1Birth: '2026-09-15',
        leave2Kind: '育休', leave2Start: '2026-11-11', leave2End: '2027-09-14', leave2Birth: '2026-09-15',
      }),
    );
    const leaves = r.rows[0].parsed!.leaves;
    expect(leaves.map((l) => l.kind)).toEqual(['maternity', 'childcare']);
    expect(leaves[0].birthDate).toBe('2026-09-15');
    expect(leaves[1].childBirthDate).toBe('2026-09-15');
    expect(leaves[1].plannedEnd).toBe('2027-09-14');
  });
  it('外国籍でローマ字があれば、届書の氏名はローマ字', () => {
    const r = readEmployeeCsv(
      table({ ...BASE, lastName: '', firstName: '', lastNameKana: 'グエン', firstNameKana: 'ヴァン', nationality: 'vn', romanLastName: 'Nguyen', romanFirstName: 'Van' }),
    );
    const e = r.rows[0].parsed!.employee;
    expect(e.lastName).toBe('NGUYEN');
    expect(e.foreign?.nationality).toBe('VN');
    expect(e.nameOrder).toBe('roman');
  });
});

describe('planImport：契約から加入と標準報酬を出す', () => {
  const plan = (rows: Record<string, string>[], ctx = CTX) => planImport(readEmployeeCsv(table(...rows)).rows, ctx);

  it('正社員は加入。資格取得日は入社日、標準報酬は見込みの報酬月額から', () => {
    const it0 = plan([BASE]).items[0];
    expect(it0.classification.category).toBe('regular');
    expect(it0.employee.health).toEqual({ enrolled: true, acquiredDate: '2026-04-01', lostDate: null, lossReason: null });
    expect(it0.remuneration).toEqual({
      from: '2026-04',
      reason: 'acquisition',
      monthlyAmount: 300000,
      health: { grade: 22, standard: 300000 },
      pension: { grade: 19, standard: 300000 },
    });
  });
  it('週20時間のパートは、特定適用事業所でなければ加入しない（標準報酬も作らない）', () => {
    const it0 = plan([{ ...BASE, employmentType: 'パート', weeklyHours: '20', monthlyDays: '12' }]).items[0];
    expect(it0.classification.reason).toBe('notSpecific');
    expect(it0.employee.health.enrolled).toBeFalse();
    expect(it0.remuneration).toBeNull();
    expect(it0.warnings).toEqual(['notInsured']);
  });
  it('加入の列で上書きできる', () => {
    const it0 = plan([{ ...BASE, employmentType: 'パート', weeklyHours: '20', monthlyDays: '12', healthEnrolled: 'はい', pensionEnrolled: 'はい' }]).items[0];
    expect(it0.employee.health.enrolled).toBeTrue();
    expect(it0.warnings).toContain('override');
    expect(it0.remuneration).not.toBeNull();
  });
  it('退職日があれば喪失日は翌日', () => {
    const it0 = plan([{ ...BASE, retireDate: '2026-09-30' }]).items[0];
    expect(it0.employee.health.lostDate).toBe('2026-10-01');
    expect(it0.employee.retireReason).toBe('resign');
  });
  it('報酬月額と開始月を上書きできる。等級表より前の月は、いちばん古い表で出して注意', () => {
    const it0 = plan([{ ...BASE, hireDate: '2020-04-01', monthlyAmount: '320000', remunerationFrom: '2020-04' }]).items[0];
    expect(it0.remuneration?.from).toBe('2020-04');
    expect(it0.remuneration?.health.standard).toBe(320000);
    expect(it0.warnings).toContain('oldTable');
  });
  it('社員番号の重複（ファイルの中・登録済み）は取り込まない', () => {
    const p = plan([BASE, BASE, { ...BASE, employeeNumber: 'E999' }], { ...CTX, existingNumbers: new Set(['E999']) });
    expect(p.items.length).toBe(1);
    expect(p.errors.map((e) => e.code)).toEqual(['duplicateInFile', 'alreadyExists']);
  });
  it('事業所の所定が空なら判定できない → 加入しないで登録して注意', () => {
    const it0 = plan([BASE], { ...CTX, office: { standardHours: null } }).items[0];
    expect(it0.warnings).toEqual(['unknownCategory']);
    expect(it0.employee.health.enrolled).toBeFalse();
  });
});
