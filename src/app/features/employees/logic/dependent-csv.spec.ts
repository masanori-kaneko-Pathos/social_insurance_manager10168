import { DEPENDENT_COLUMNS, DEPENDENT_CSV_HEADERS, dependentFixColumns, personKey, planDependentImport } from './dependent-csv';

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

describe('dependentFixColumns（エラー → 直す欄。11/16）', () => {
  it('コードから直す欄を決める（画面と同じチェックは field.欄.コード）', () => {
    expect(dependentFixColumns(['employeeNotFound', 'date'])).toEqual(['employeeNumber', 'birthDate', 'from', 'to']);
    expect(dependentFixColumns(['field.address.required', 'field.address.tooLong'])).toEqual(['address']);
    expect(dependentFixColumns(['field.unknownField.x', 'nothing'])).toEqual([]);
  });
});

describe('続柄の「その他」と、扶養に入れない続柄（11/17）', () => {
  const H = DEPENDENT_COLUMNS.map((c) => DEPENDENT_CSV_HEADERS[c]);
  const emp = [{ id: 'a', employeeNumber: 'E1', lastName: '山田', firstName: '太郎', hireDate: '2000-01-01' }];
  const line = (x: Partial<Record<(typeof DEPENDENT_COLUMNS)[number], string>>) =>
    DEPENDENT_COLUMNS.map((c) => ({ employeeNumber: 'E1', lastName: '山田', firstName: '花', lastNameKana: 'ヤマダ', firstNameKana: 'ハナ',
      birthDate: '1960-01-01', from: '2020-01-01', livingTogether: 'はい', ...x } as Record<string, string>)[c] ?? '');
  const read = (x: Partial<Record<(typeof DEPENDENT_COLUMNS)[number], string>>) => planDependentImport([H, line(x)], emp, new Map(), '2026-11-17')[0];

  it('その他 ＋ 補足の列なら読める。補足がなければ、続柄と補足の2つを直す欄に出す', () => {
    expect(read({ relationship: 'その他', relationshipNote: '叔母' }).input?.relationshipNote).toBe('叔母');
    const r = read({ relationship: 'その他' });
    expect(r.errors).toContain('field.relationshipNote.required');
    expect(dependentFixColumns(r.errors)).toEqual(['relationship', 'relationshipNote']);
  });

  it('いとこ は「読めない」ではなく「扶養に入れない」', () => {
    const r = read({ relationship: 'いとこ' });
    expect(r.errors).toContain('relationshipNotEligible');
    expect(r.errors).not.toContain('relationship');
  });
});
