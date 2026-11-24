import { exportTable, picksOf } from '../../../shared/export/export-table';
import { buildPremiumCsv, PremiumCsvRow } from './premium-csv';
import { PREMIUM_DEFAULT_KEYS, PremiumExportRow, premiumExportColumns } from './premium-export-columns';

const HEAD_JA = [
  '社員番号', '氏名', '健保 等級', '健保 標準報酬月額', '介護', '厚年 等級', '厚年 標準報酬月額',
  '本人負担 健保等', '本人負担 厚年', '本人負担 合計', '会社負担（目安）', '全額', '拠出金（会社）', '備考',
];

const row = (over: Partial<PremiumExportRow>): PremiumExportRow =>
  ({
    state: 'ok',
    result: { groups: [], employeeYen: 45408 },
    health: { grade: 22, standard: 300000 },
    pension: { grade: 19, standard: 300000 },
    care: false,
    healthEmployeeYen: 16128,
    pensionEmployeeYen: 29280,
    premiumEmployerMilli: 45407500,
    premiumTotalMilli: 90815500,
    contributionMilli: 1080000,
    changes: [],
    lastMonth: false,
    sameMonthPension: false,
    employee: { employeeNumber: '0001', lastName: '山田', firstName: '太郎', lastNameKana: 'ヤマダ', firstNameKana: 'タロウ', org: { departmentId: 'd1' } },
    ...over,
  }) as unknown as PremiumExportRow;

describe('保険料一覧の目録（項目を選んで出力。11/24）', () => {
  const rows = [row({}), row({ state: 'exempt', employee: { employeeNumber: '0002', lastName: '佐藤', firstName: '花子' } })];
  const catalog = premiumExportColumns({
    t: (k) => (k.startsWith('exportCols.premium.') ? HEAD_JA[PREMIUM_DEFAULT_KEYS.indexOf(k.slice(19) as never)] ?? k : k),
    deptName: (id) => (id === 'd1' ? '総務部' : ''),
    note: (r) => (r.state === 'exempt' ? '免除' : ''),
    month: '2026-10',
    payMonth: '2026-11',
  });

  it('標準の形は、今までの CSV の人の行と同じ（見出し・値・計算できない人の空欄）', () => {
    const csv = buildPremiumCsv(
      rows.map((r): PremiumCsvRow => ({
        employeeNumber: r.employee.employeeNumber ?? null,
        name: `${r.employee.lastName} ${r.employee.firstName}`,
        state: r.state as PremiumCsvRow['state'],
        health: r.health,
        pension: r.pension,
        care: r.care,
        healthEmployeeYen: r.healthEmployeeYen,
        pensionEmployeeYen: r.pensionEmployeeYen,
        employeeYen: r.result?.employeeYen ?? 0,
        employerMilli: r.premiumEmployerMilli,
        totalMilli: r.premiumTotalMilli,
        contributionMilli: r.contributionMilli,
        note: r.state === 'exempt' ? '免除' : '',
      })),
      [],
      'ja',
    );
    expect(exportTable(rows, catalog, picksOf(PREMIUM_DEFAULT_KEYS))).toEqual(csv.slice(0, 3));
  });

  it('標準にない項目：部署・フリガナ・何月分', () => {
    const t = exportTable(rows, catalog, picksOf(['department', 'kana', 'month', 'payMonth']));
    expect(t[1]).toEqual(['総務部', 'ヤマダ タロウ', '2026-10', '2026-11']);
  });
});
