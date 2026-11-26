import { AppDeduction, compareDeductions, softwareExportRows, STANDARD_CHANGE_HEADER, standardChangeRows } from './payroll-software';

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
    expect(rows[1]).toEqual(['0012', '伊藤 一郎', '2026-10', '2026-11', '300000', '300000', '1', '14955', '27450', '42405', '', '', '', '', '']);
  });

  it('等級は後ろの2列（前の列の位置は変えない。11/26）', () => {
    const rows = softwareExportRows(
      [{ employeeNumber: '0012', name: '伊藤 一郎', healthStandard: 300000, pensionStandard: 300000, healthGrade: 22, pensionGrade: 19, care: false, healthEmployeeYen: 14955, pensionEmployeeYen: 27450 }],
      '2026-10',
      '2026-11',
    );
    expect(rows[0].slice(-2)).toEqual(['健保 等級', '厚年 等級']);
    expect(rows[1].slice(-2)).toEqual(['22', '19']);
    expect(rows[0].slice(0, 4)).toEqual(['社員番号', '氏名', '対象月', '控除する給与の月']);
  });

  it('標準報酬が変わる人：前 → 後。資格を取った人は前が空。0人なら見出しだけ', () => {
    const rows = standardChangeRows(
      [
        {
          employeeNumber: '0012',
          name: '伊藤 一郎',
          reason: '定時決定',
          before: { health: { grade: 22, standard: 300000 }, pension: { grade: 19, standard: 300000 }, employeeYen: 42405 },
          after: { health: { grade: 23, standard: 320000 }, pension: { grade: 20, standard: 320000 }, employeeYen: 45408 },
        },
        {
          employeeNumber: null,
          name: '佐藤 花子',
          reason: '資格取得時決定',
          before: { health: null, pension: null, employeeYen: null },
          after: { health: { grade: 18, standard: 220000 }, pension: { grade: 15, standard: 220000 }, employeeYen: 31000 },
        },
      ],
      '2026-09',
      '2026-10',
    );
    expect(rows[0]).toEqual([...STANDARD_CHANGE_HEADER]);
    expect(rows[1]).toEqual(['0012', '伊藤 一郎', '定時決定', '2026-09', '2026-10', '22', '300000', '23', '320000', '19', '300000', '20', '320000', '42405', '45408']);
    expect(rows[2].slice(5, 9)).toEqual(['', '', '18', '220000']);
    expect(rows[2][13]).toBe('');
    expect(standardChangeRows([], '2026-09', '2026-10')).toEqual([[...STANDARD_CHANGE_HEADER]]);
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
