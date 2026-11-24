import { exportTable, picksOf } from '../../../shared/export/export-table';
import { bonusExportTable } from './bonus-export';
import { BONUS_DEFAULT_KEYS, BonusExportItem, bonusExportColumns, bonusExportItems } from './bonus-export-columns';

const H = ['no', 'name', 'date', 'amount', 'std', 'health', 'pension', 'sum', 'employer', 'note'];

function person(over: Omit<Partial<BonusExportItem>, 'row'> & { row?: Partial<BonusExportItem['row']> }): BonusExportItem {
  return {
    employeeNumber: 'E001',
    name: '山本 誠',
    amountYen: 500_123,
    note: '',
    employee: { lastNameKana: 'ヤマモト', firstNameKana: 'マコト', org: { departmentId: 'd1' } },
    ...over,
    row: {
      state: 'ok',
      result: {
        standardBonus: 500_000, healthBase: 500_000, pensionBase: 500_000, employeeYen: 72_325,
        healthStatus: 'charged', pensionStatus: 'charged', groups: [],
      } as never,
      healthEmployeeYen: 26_575,
      pensionEmployeeYen: 45_750,
      premiumEmployerMilli: 72_325_500,
      premiumTotalMilli: 144_651_000,
      contributionMilli: 1_800_000,
      ...over.row,
    },
  };
}

describe('賞与の目録（項目を選んで出力。11/24）', () => {
  const catalog = bonusExportColumns({
    t: (k) => (k.startsWith('exportCols.bonus.') ? H[BONUS_DEFAULT_KEYS.indexOf(k.slice(17) as never)] ?? k : k),
    deptName: (id) => (id === 'd1' ? '営業部' : ''),
    paidDate: '2026-12-10',
  });
  const people = [
    person({}),
    person({ employeeNumber: 'E002', amountYen: 0 }),
    person({
      employeeNumber: 'E003',
      note: '免除',
      row: {
        state: 'exempt',
        result: { standardBonus: 300_000, healthBase: 300_000, pensionBase: 300_000, healthStatus: 'charged', pensionStatus: 'charged', groups: [] } as never,
      },
    }),
    person({
      employeeNumber: 'E004',
      row: {
        result: {
          standardBonus: 500_000, healthBase: 500_000, pensionBase: 0, employeeYen: 26_575,
          healthStatus: 'charged', pensionStatus: 'none', groups: [],
        } as never,
      },
    }),
  ];

  it('標準の形は、今までの書き出しと同じ（額のない人は出さない・免除は金額が空で備考あり・厚年なしは空）', () => {
    expect(exportTable(bonusExportItems(people), catalog, picksOf(BONUS_DEFAULT_KEYS))).toEqual(
      bonusExportTable(H, '2026-12-10', people),
    );
  });

  it('足した項目：フリガナ・部署・上限後の額・全額・拠出金', () => {
    const t = exportTable(bonusExportItems(people), catalog, picksOf(['number', 'kana', 'department', 'healthBase', 'pensionBase', 'total', 'contribution']));
    expect(t[1]).toEqual(['E001', 'ヤマモト マコト', '営業部', '500000', '500000', '144651', '1800']);
    // 免除でも賞与支払届は出すので、上限後の額は出す（金額の列は空）
    expect(t[2]).toEqual(['E003', 'ヤマモト マコト', '営業部', '300000', '300000', '', '']);
    expect(t[3]).toEqual(['E004', 'ヤマモト マコト', '営業部', '500000', '', '144651', '1800']);
  });
});
