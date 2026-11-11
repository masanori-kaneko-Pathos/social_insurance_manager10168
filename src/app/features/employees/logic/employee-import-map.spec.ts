import { guessMapping, isOurFormat, Mapping, missingRequired, toOurTable } from '../../../shared/import/column-map';
import {
  EMPLOYEE_COLUMNS,
  EMPLOYEE_CSV_HEADERS,
  EMPLOYEE_IMPORT_FIELDS,
  EMPLOYEE_TABLE_SPEC,
  EmployeeImportKey,
  employeeCsvTemplate,
  finishEmployeeRow,
  readEmployeeCsv,
} from './employee-csv';

// よくある書き出しの見出しの例（11/11 に労務ソフトのヘルプで調べた形。A〜C は書き出しの形の違い）
const EXPORT_A = ['従業員コード', '所属コード', '姓', '名', '姓カナ', '名カナ', '男女コード', '生年月日', '入社日',
  '退職日', '雇用区分コード', 'メールアドレス', '日の契約労働時間', '週の契約労働日数'];
const EXPORT_B = ['姓', '名', '姓カナ', '名カナ', '表示名', '入社日', '退職日', '従業員番号', '生年月日', '性別',
  '雇用形態', '基礎年金番号', '給与方式', '基本給', '1日の所定労働時間(分)', '一ヶ月の平均所定労働日数',
  '健康保険に加入しているか', '健康保険標準報酬月額', '健康保険の被保険者整理番号', '厚生年金保険に加入しているか'];
const EXPORT_C = ['社員番号', '姓', '名', '姓（ヨミガナ）', '名（ヨミガナ）', '生年月日', '戸籍上の性別', '入社年月日',
  '雇用形態', '給与支給形態', '基礎年金番号'];

const col = (headers: string[], h: string) => ({ col: headers.indexOf(h) });

describe('従業員の取り込み：よその見出しを当てる', () => {
  it('形A：コードと分（従業員コード・男女コード・日の契約労働時間）', () => {
    const m = guessMapping(EXPORT_A, EMPLOYEE_IMPORT_FIELDS);
    expect(m.employeeNumber).toEqual(col(EXPORT_A, '従業員コード'));
    expect(m.lastNameKana).toEqual(col(EXPORT_A, '姓カナ'));
    expect(m.sex).toEqual(col(EXPORT_A, '男女コード'));
    expect(m.dailyMinutes).toEqual(col(EXPORT_A, '日の契約労働時間'));
    expect(m.weeklyDays).toEqual(col(EXPORT_A, '週の契約労働日数'));
    expect(m.employmentType).toBeUndefined(); // 会社ごとのコードなので自動では結ばない
    // 週の時間・月の日数は計算で足りる。足りないのは給与の形・所定内賃金・雇用形態
    expect(missingRequired(EMPLOYEE_IMPORT_FIELDS, m).sort()).toEqual(['employmentType', 'payType', 'scheduledWage']);
  });

  it('形B：加入・標準報酬・1日の分と月の平均日数', () => {
    const m = guessMapping(EXPORT_B, EMPLOYEE_IMPORT_FIELDS);
    expect(m.employeeNumber).toEqual(col(EXPORT_B, '従業員番号'));
    expect(m.payType).toEqual(col(EXPORT_B, '給与方式'));
    expect(m.dailyMinutes).toEqual(col(EXPORT_B, '1日の所定労働時間(分)'));
    expect(m.monthlyDays).toEqual(col(EXPORT_B, '一ヶ月の平均所定労働日数'));
    expect(m.healthEnrolled).toEqual(col(EXPORT_B, '健康保険に加入しているか'));
    expect(m.monthlyAmount).toEqual(col(EXPORT_B, '健康保険標準報酬月額'));
    expect(m.insuredNumber).toEqual(col(EXPORT_B, '健康保険の被保険者整理番号'));
    expect(m.scheduledWage).toBeUndefined(); // 基本給 ≠ 所定内賃金（諸手当を含まない）。人が決める
    // 週の時間は、週の日数がないので計算できない
    expect(missingRequired(EMPLOYEE_IMPORT_FIELDS, m).sort()).toEqual(['scheduledWage', 'weeklyHours']);
  });

  it('形C：ヨミガナ・戸籍上の性別・入社年月日', () => {
    const m = guessMapping(EXPORT_C, EMPLOYEE_IMPORT_FIELDS);
    expect(m.lastNameKana).toEqual(col(EXPORT_C, '姓（ヨミガナ）'));
    expect(m.sex).toEqual(col(EXPORT_C, '戸籍上の性別'));
    expect(m.hireDate).toEqual(col(EXPORT_C, '入社年月日'));
    expect(m.payType).toEqual(col(EXPORT_C, '給与支給形態'));
    expect(m.basicPensionNumber).toEqual(col(EXPORT_C, '基礎年金番号'));
  });

  it('うちのひな形は、うちの見出しそのまま', () => {
    expect(isOurFormat(employeeCsvTemplate()[0], EMPLOYEE_IMPORT_FIELDS)).toBeTrue();
    expect(isOurFormat(EXPORT_A, EMPLOYEE_IMPORT_FIELDS)).toBeFalse();
  });
});

describe('従業員の取り込み：項目どうしの計算', () => {
  it('1日の分 × 週の日数 → 週の時間、週の日数 × 52 ÷ 12（切り捨て）→ 月の日数', () => {
    const v = finishEmployeeRow({ dailyMinutes: '480', weeklyDays: '5' });
    expect(v.weeklyHours).toBe('40:00');
    expect(v.monthlyDays).toBe('21');
    expect(finishEmployeeRow({ dailyMinutes: '330', weeklyDays: '4' }).weeklyHours).toBe('22:00');
  });

  it('列に値があれば、計算で上書きしない', () => {
    const v = finishEmployeeRow({ dailyMinutes: '480', weeklyDays: '5', weeklyHours: '38:45', monthlyDays: '20' });
    expect(v.weeklyHours).toBe('38:45');
    expect(v.monthlyDays).toBe('20');
  });

  it('氏名・フリガナが1列なら分ける（姓・名の列があればそちら）', () => {
    expect(finishEmployeeRow({ fullName: '山田 太郎', fullNameKana: 'ヤマダ タロウ' })).toEqual(
      jasmine.objectContaining({ lastName: '山田', firstName: '太郎', lastNameKana: 'ヤマダ', firstNameKana: 'タロウ' }),
    );
    expect(finishEmployeeRow({ fullName: '山田 太郎', lastName: '山田' }).firstName).toBeUndefined();
  });
});

describe('従業員の取り込み：よそのファイル → 今の読み取りまで', () => {
  it('形A の書き出し（足りない項目は全員に同じ値）', () => {
    const table = [
      EXPORT_A,
      ['0012', 'A01', '山田', '太郎', 'ﾔﾏﾀﾞ', 'ﾀﾛｳ', '1', '1990/05/15', '2026/04/01', '', '01', 'a@example.com', '480', '5'],
      ['0013', 'A01', '佐藤', '花子', 'ｻﾄｳ', 'ﾊﾅｺ', '2', 'H7.8.1', '2026/10/01', '', '02', '', '300', '4'],
    ];
    const m: Mapping<EmployeeImportKey> = {
      ...guessMapping(EXPORT_A, EMPLOYEE_IMPORT_FIELDS),
      employmentType: { fixed: '正社員' },
      payType: { fixed: '月給' },
      scheduledWage: { fixed: '250000' },
    };
    expect(missingRequired(EMPLOYEE_IMPORT_FIELDS, m)).toEqual([]);
    const ours = toOurTable(table, m, EMPLOYEE_TABLE_SPEC);
    expect(ours[0]).toEqual(EMPLOYEE_COLUMNS.map((c) => EMPLOYEE_CSV_HEADERS[c]));

    const read = readEmployeeCsv(ours);
    expect(read.missingColumns).toEqual([]);
    expect(read.rows.map((r) => r.errors)).toEqual([[], []]);
    const [a, b] = read.rows.map((r) => r.parsed!);
    expect(a.employee.employeeNumber).toBe('0012');
    expect(a.employee.lastNameKana).toBe('ヤマダ');
    expect(a.employee.sex).toBe('male');
    expect(a.employee.birthDate).toBe('1990-05-15');
    expect(a.contract.weeklyMinutes).toBe(40 * 60);
    expect(a.contract.monthlyDays).toBe(21);
    expect(b.employee.sex).toBe('female');
    expect(b.employee.birthDate).toBe('1995-08-01');
    expect(b.contract.weeklyMinutes).toBe(20 * 60);
    expect(b.contract.monthlyDays).toBe(17);
  });

  it('形B の加入・標準報酬・番号', () => {
    const row = ['山田', '太郎', 'ヤマダ', 'タロウ', '山田太郎', '2026/04/01', '', 'E1', '1990/05/15', '男性', 'パート・アルバイト',
      '1234-567890', '時給', '0', '360', '15.5', '加入している', '200,000', '123', '加入していない'];
    const m: Mapping<EmployeeImportKey> = {
      ...guessMapping(EXPORT_B, EMPLOYEE_IMPORT_FIELDS),
      weeklyHours: { fixed: '24' },
      hourlyWage: { fixed: '1000' }, // 時給の人は時給の額が要る（契約の部品のチェック）
      scheduledWage: { fixed: '100000' },
    };
    const read = readEmployeeCsv(toOurTable([EXPORT_B, row], m, EMPLOYEE_TABLE_SPEC));
    expect(read.rows[0].errors).toEqual([]);
    const p = read.rows[0].parsed!;
    expect(p.contract.employmentType).toBe('part');
    expect(p.contract.payType).toBe('hourly');
    expect(p.contract.monthlyDays).toBe(15); // 15.5 は切り捨て
    expect(p.employee.basicPensionNumber).toBe('1234567890');
    expect(p.employee.insuredNumber).toBe('123');
    expect(p.healthOverride).toBeTrue();
    expect(p.pensionOverride).toBeFalse();
    expect(p.monthlyAmount).toBe(200000);
  });

  it('読めない値は消さずに渡し、今の確認画面のエラーになる', () => {
    const m: Mapping<EmployeeImportKey> = {
      ...guessMapping(EXPORT_A, EMPLOYEE_IMPORT_FIELDS),
      employmentType: { fixed: '正社員' },
      payType: { fixed: '月給' },
      scheduledWage: { fixed: '250000' },
    };
    const bad = ['1', '', '山田', '', 'ヤマダ', '', '3', '1990/02/30', '2026/04/01', '', '', '', '480', '5'];
    const read = readEmployeeCsv(toOurTable([EXPORT_A, bad], m, EMPLOYEE_TABLE_SPEC));
    const errs = read.rows[0].errors.map((e) => `${e.column}:${e.code}`);
    expect(errs).toContain('birthDate:date');
    expect(errs).toContain('sex:choice');
    expect(read.rows[0].values.birthDate).toBe('1990/02/30');
  });

  it('基礎年金番号の形が違えばエラー', () => {
    const header = employeeCsvTemplate()[0];
    const row = [...employeeCsvTemplate()[1]];
    row[header.indexOf('基礎年金番号')] = '12345';
    const read = readEmployeeCsv([header, row]);
    expect(read.rows[0].errors.map((e) => `${e.column}:${e.code}`)).toEqual(['basicPensionNumber:pensionNumber']);
  });
});
