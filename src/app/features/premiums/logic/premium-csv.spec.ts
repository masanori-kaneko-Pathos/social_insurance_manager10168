import { parseCsv, toCsv } from '../../../shared/csv/csv';
import { buildPremiumCsv, milliText, PremiumCsvRow, premiumFileName } from './premium-csv';

const ICHIRO: PremiumCsvRow = {
  employeeNumber: '0012',
  name: 'テスト 一郎',
  state: 'ok',
  health: { grade: 24, standard: 340000 },
  pension: { grade: 21, standard: 340000 },
  care: false,
  healthEmployeeYen: 17136,
  pensionEmployeeYen: 31110,
  employeeYen: 48246,
  employerMilli: 48246000,
  totalMilli: 96492000,
  contributionMilli: 1224000,
  note: '',
};

describe('milliText', () => {
  it('円ちょうど・小数・負', () => {
    expect(milliText(16745000)).toBe('16745');
    expect(milliText(16745500)).toBe('16745.5');
    expect(milliText(16745050)).toBe('16745.05');
    expect(milliText(1)).toBe('0.001');
    expect(milliText(-500)).toBe('-0.5');
  });
});

describe('buildPremiumCsv', () => {
  it('1人1行 ＋ 空行 ＋ 合計', () => {
    const exempt: PremiumCsvRow = { ...ICHIRO, employeeNumber: null, name: 'テスト 五子', state: 'exempt', note: '産休・育休のため免除（0円）' };
    const rows = buildPremiumCsv(
      [ICHIRO, exempt],
      [
        { label: '健康保険料', totalYen: 34272, employeeYen: 17136, employerYen: 17136 },
        { label: '厚生年金保険料', totalYen: 62220, employeeYen: 31110, employerYen: 31110 },
        { label: '子ども・子育て拠出金', totalYen: 1224, employeeYen: 0, employerYen: 1224 },
      ],
      'ja',
    );
    expect(rows[1]).toEqual([
      '0012', 'テスト 一郎', '24', '340000', '', '21', '340000', '17136', '31110', '48246', '48246', '96492', '1224', '',
    ]);
    // 免除の人は等級だけ出して金額は空、備考に理由
    expect(rows[2].slice(7, 13)).toEqual(['', '', '', '', '', '']);
    expect(rows[2][13]).toBe('産休・育休のため免除（0円）');
    expect(rows[3]).toEqual([]);
    expect(rows[4][0]).toBe('事業所の合計');
    expect(rows[4]).toEqual(['事業所の合計', '', '本人負担の合計', '会社負担', '納付額']);
    expect(rows[5]).toEqual(['健康保険料', '', '17136', '17136', '34272']);
    expect(rows[rows.length - 1]).toEqual(['納付額の合計', '', '', '', '97716']);
  });

  it('絞り込んで出力すると、人の行のすぐ下に小計、合計は「全員分」と書く', () => {
    const exempt: PremiumCsvRow = { ...ICHIRO, state: 'exempt' };
    const rows = buildPremiumCsv([ICHIRO, ICHIRO, exempt], [], 'ja', { note: '営業部' });
    // 免除の人は人数には入るが、金額には足さない
    expect(rows[4]).toEqual([
      '', '絞り込んだ人の小計（3人・営業部）', '', '', '', '', '', '34272', '62220', '96492', '96492', '192984', '2448', '',
    ]);
    expect(rows[5]).toEqual([]);
    expect(rows[6][0]).toBe('事業所全体の合計（絞り込みに関係なく全員分）');
  });

  it('CSV にして読み戻せる（空行は空の1列）', () => {
    const rows = buildPremiumCsv([ICHIRO], [], 'en');
    const back = parseCsv(toCsv(rows));
    expect(back[1][1]).toBe('テスト 一郎');
    expect(back[2]).toEqual(['']);
  });
});

describe('premiumFileName', () => {
  it('何月分か', () => {
    expect(premiumFileName('伊藤テスト中商事', '2026-11', '2026-11-06', 'ja')).toBe(
      '保険料一覧_伊藤テスト中商事_2026-11分_20261106.csv',
    );
  });
});
