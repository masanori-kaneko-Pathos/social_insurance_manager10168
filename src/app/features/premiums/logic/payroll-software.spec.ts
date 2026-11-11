import { AppDeduction, compareDeductions, softwareExportRows } from './payroll-software';

const app: AppDeduction[] = [
  { id: 'a', employeeNumber: '0012', lastName: '伊藤', firstName: '一郎', healthEmployeeYen: 14955, pensionEmployeeYen: 27450 },
  { id: 'b', employeeNumber: null, lastName: '佐藤', firstName: '花子', healthEmployeeYen: 10000, pensionEmployeeYen: 18300 },
  { id: 'c', employeeNumber: '0099', lastName: '鈴木', firstName: '次郎', healthEmployeeYen: 9000, pensionEmployeeYen: 16000 },
];
const H = ['社員番号', '氏名', '健康保険料', '介護保険料', '厚生年金保険料', '社会保険料の合計'];

describe('payroll-software：給与ソフトとの役割分担', () => {
  it('給与ソフトに渡す一覧', () => {
    const rows = softwareExportRows(
      [{ employeeNumber: '0012', name: '伊藤 一郎', healthStandard: 300000, pensionStandard: 300000, care: true, healthEmployeeYen: 14955, pensionEmployeeYen: 27450 }],
      '2026-10',
      '2026-11',
    );
    expect(rows[1]).toEqual(['0012', '伊藤 一郎', '2026-10', '2026-11', '300000', '300000', '1', '14955', '27450', '42405']);
  });

  it('健保＋介護で比べる。先頭の0は無視。氏名でも照合。ファイルにいない人は最後', () => {
    const r = compareDeductions(
      [H, ['12', '', '12300', '2655', '27450', ''], ['', '佐藤 花子', '10000', '', '18301', ''], ['777', '', '1', '', '1', '']],
      app,
    );
    expect(r[0].status).toBe('match');
    expect(r[1].status).toBe('diff');
    expect(r[1].diff).toBe(1);
    expect(r[2].status).toBe('notInApp');
    expect(r[3].status).toBe('notInFile');
    expect(r[3].employee?.id).toBe('c');
  });

  it('健保・厚年が分かれていなければ合計で比べる', () => {
    const r = compareDeductions([H, ['0012', '', '', '', '', '42405']], app);
    expect(r[0].status).toBe('match');
  });

  it('同じ氏名が2人なら ambiguous', () => {
    const twins = [...app, { ...app[1], id: 'd' }];
    expect(compareDeductions([H, ['', '佐藤花子', '1', '', '1', '']], twins)[0].status).toBe('ambiguous');
  });
});
