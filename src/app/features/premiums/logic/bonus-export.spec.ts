import { bonusExportTable, BonusExportInput } from './bonus-export';

const H = ['no', 'name', 'date', 'amount', 'std', 'health', 'pension', 'sum', 'employer', 'note'];
function person(over: Omit<Partial<BonusExportInput>, 'row'> & { row?: Partial<BonusExportInput['row']> }): BonusExportInput {
  return {
    employeeNumber: 'E001',
    name: '山本 誠',
    amountYen: 500_123,
    note: '',
    ...over,
    row: {
      state: 'ok',
      result: { standardBonus: 500_000, employeeYen: 72_325, pensionStatus: 'charged' } as never,
      healthEmployeeYen: 26_575,
      pensionEmployeeYen: 45_750,
      premiumEmployerMilli: 72_325_500,
      ...over.row,
    },
  };
}

describe('bonusExportTable：賞与の書き出し（本人負担まで）', () => {
  it('見出しのあとに1人1行。数字はカンマなし、会社負担は銭まで', () => {
    const t = bonusExportTable(H, '2026-12-10', [person({})]);
    expect(t[0]).toEqual(H);
    expect(t[1]).toEqual(['E001', '山本 誠', '2026-12-10', '500123', '500000', '26575', '45750', '72325', '72325.5', '']);
  });

  it('額の入っていない人は出さない', () => {
    expect(bonusExportTable(H, '2026-12-10', [person({ amountYen: 0 })]).length).toBe(1);
  });

  it('厚年がかからない人は厚年の欄が空', () => {
    const t = bonusExportTable(H, '2026-12-10', [
      person({ row: { result: { standardBonus: 500_000, employeeYen: 26_575, pensionStatus: 'none' } as never } }),
    ]);
    expect(t[1][6]).toBe('');
    expect(t[1][7]).toBe('26575');
  });

  it('免除などで計算しない人は、保険料の欄を空にして備考に理由', () => {
    const t = bonusExportTable(H, '2026-12-10', [person({ note: '産休・育休のため免除', row: { state: 'exempt' } })]);
    expect(t[1].slice(5, 9)).toEqual(['', '', '', '']);
    expect(t[1][4]).toBe('500000');
    expect(t[1][9]).toBe('産休・育休のため免除');
  });

  it('社員番号がない人は空欄', () => {
    expect(bonusExportTable(H, '2026-12-10', [person({ employeeNumber: null })])[1][0]).toBe('');
  });
});
