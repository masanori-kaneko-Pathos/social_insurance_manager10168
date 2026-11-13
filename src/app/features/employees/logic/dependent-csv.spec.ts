import { DEPENDENT_COLUMNS, DEPENDENT_CSV_HEADERS, personKey, planDependentImport } from './dependent-csv';

const HEAD = DEPENDENT_COLUMNS.map((c) => DEPENDENT_CSV_HEADERS[c]);
const row = (x: Partial<Record<(typeof DEPENDENT_COLUMNS)[number], string>>) => DEPENDENT_COLUMNS.map((c) => x[c] ?? '');
const EMP = [{ id: 'e1', employeeNumber: 'T0001', lastName: '山田', firstName: '太郎', hireDate: '2020-04-01' }];
const BASE = { employeeNumber: 'T0001', lastName: '山田', firstName: '花子', lastNameKana: 'ヤマダ', firstNameKana: 'ハナコ', birthDate: '1990-01-01', from: '2020-04-01' };
const run = (rows: string[][], existing = new Map<string, Set<string>>()) => planDependentImport([HEAD, ...rows], EMP, existing, '2026-11-13');

describe('扶養家族の取り込み', () => {
  it('言葉で書いた続柄・職業を読み、年収が空なら 0 円で注意を出す', () => {
    const [r] = run([row({ ...BASE, relationship: '妻', occupation: 'パート' })]);
    expect(r.errors).toEqual([]);
    expect(r.input?.relationship).toBe('spouse');
    expect(r.input?.occupation).toBe('partTime');
    expect(r.input?.annualIncome).toBe(0);
    expect(r.warnings).toContain('noIncome');
  });

  it('職業が空なら、15歳以下は小中学生以下', () => {
    const [r] = run([row({ ...BASE, relationship: '長男', firstName: '一郎', firstNameKana: 'イチロウ', birthDate: '2018-05-05', from: '2018-05-05', annualIncome: '0' })]);
    expect(r.input?.occupation).toBe('child');
  });

  it('年収が上限を超えそう・入社日より前は注意だけ', () => {
    const [r] = run([row({ ...BASE, relationship: '妻', annualIncome: '1,500,000', from: '2019-04-01' })]);
    expect(r.input).not.toBeNull();
    expect(r.warnings).toEqual(jasmine.arrayContaining(['overLimit', 'beforeHire']));
  });

  it('登録済み・ファイルの中で重なった人は飛ばす。社員番号がなければエラー', () => {
    const existing = new Map([['e1', new Set([personKey('山田', '花子', '1990-01-01')])]]);
    const rows = run([row({ ...BASE, relationship: '妻' }), row({ ...BASE, employeeNumber: 'X9', relationship: '妻' })], existing);
    expect(rows[0].skip).toBe('exists');
    expect(rows[1].errors).toContain('employeeNotFound');
  });

  it('伯父などは「その他」にして、言葉を補足に残す', () => {
    const [r] = run([row({ ...BASE, relationship: '叔父', lastName: '山田', firstName: '次郎', firstNameKana: 'ジロウ', birthDate: '1960-01-01', annualIncome: '0' })]);
    expect(r.input?.relationship).toBe('other');
    expect(r.input?.relationshipNote).toBe('叔父');
  });
});
