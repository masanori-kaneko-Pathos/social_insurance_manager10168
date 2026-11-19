import { bonusCsvTemplate, bonusFixColumns, BONUS_CSV_COLUMNS, BONUS_CSV_HEADERS, planBonusImport } from './bonus-csv';

const H = BONUS_CSV_COLUMNS.map((c) => BONUS_CSV_HEADERS[c]);
const row = (x: Partial<Record<(typeof BONUS_CSV_COLUMNS)[number], string>>) => BONUS_CSV_COLUMNS.map((c) => x[c] ?? '');
const people = [
  { id: 'a', employeeNumber: 'E001', lastName: '山田', firstName: '太郎', hireDate: '2020-04-01', retireDate: null },
  { id: 'b', employeeNumber: 'E002', lastName: '佐藤', firstName: '花子', hireDate: '2026-08-01', retireDate: null },
  { id: 'c', employeeNumber: 'E003', lastName: '鈴木', firstName: '一郎', hireDate: '2020-04-01', retireDate: '2026-06-30' },
  { id: 'd', employeeNumber: 'E004', lastName: '田中', firstName: '次郎', hireDate: '2020-04-01', retireDate: null },
  { id: 'e', employeeNumber: 'E005', lastName: '田中', firstName: '次郎', hireDate: '2021-04-01', retireDate: null },
];

describe('planBonusImport：賞与の取り込み（11/17）', () => {
  it('同じ支払日の行を1回の支給にまとめる。名称は最初の行。和暦・カンマ・円も読む', () => {
    const p = planBonusImport(
      [
        H,
        row({ employeeNumber: 'E001', paidDate: '2026/7/10', title: '夏季賞与', amount: '500,000円' }),
        row({ employeeNumber: '1', paidDate: '2026-07-10', title: '夏賞与', amount: '1' }),
        row({ employeeNumber: 'E004', paidDate: '令和8年12月10日', amount: '300000', inKind: '5000' }),
      ],
      people,
      [],
    );
    expect(p.rows.map((r) => r.status)).toEqual(['new', 'error', 'new']);
    expect(p.rows[1].errors).toEqual(['employeeNotFound']);
    expect(p.writes.length).toBe(2);
    expect(p.writes[0]).toEqual({
      paidDate: '2026-07-10',
      existingId: null,
      input: { paidDate: '2026-07-10', title: '夏季賞与', amounts: { a: 500000 }, inKindAmounts: {} },
      count: 1,
    });
    expect(p.writes[1].input.inKindAmounts).toEqual({ d: 5000 });
  });

  it('登録済みの支給に足し込む：ファイルにいない人の額は残る。追加・上書き・変わらないを分ける', () => {
    const existing = [{ id: 'x', paidDate: '2026-07-10', title: '夏季賞与', amounts: { a: 500000, d: 100 }, inKindAmounts: { d: 10 } }];
    const p = planBonusImport(
      [
        H,
        row({ employeeNumber: 'E001', paidDate: '2026-07-10', amount: '500000' }),
        row({ employeeNumber: 'E004', paidDate: '2026-07-10', amount: '200' }),
        row({ employeeNumber: 'E002', paidDate: '2026-07-10', amount: '300' }),
      ],
      people,
      existing,
    );
    expect(p.rows.map((r) => r.status)).toEqual(['same', 'update', 'add']);
    expect(p.writes).toEqual([
      {
        paidDate: '2026-07-10',
        existingId: 'x',
        input: { paidDate: '2026-07-10', title: '夏季賞与', amounts: { a: 500000, d: 200, b: 300 }, inKindAmounts: { d: 10 } },
        count: 2,
      },
    ]);
  });

  it('変わらない人だけの支払日は書かない', () => {
    const existing = [{ id: 'x', paidDate: '2026-07-10', title: null, amounts: { a: 1 } }];
    const p = planBonusImport([H, row({ employeeNumber: 'E001', paidDate: '2026-07-10', amount: '1' })], people, existing);
    expect(p.writes).toEqual([]);
  });

  it('エラーと注意：重なり・読めない日付と額・マイナス・同じ氏名・入社前・退職後・名称の違い', () => {
    const p = planBonusImport(
      [
        H,
        row({ employeeNumber: 'E001', paidDate: '2026-07-10', title: '夏', amount: '1' }),
        row({ employeeNumber: 'E001', paidDate: '2026-07-10', title: '冬', amount: '2' }),
        row({ employeeNumber: 'E001', paidDate: '2026-02-30', amount: '1' }),
        row({ employeeNumber: 'E001', paidDate: '2026-12-10', amount: '-1', inKind: 'abc' }),
        row({ name: '田中 次郎', paidDate: '2026-12-10', amount: '1' }),
        row({ name: '山田　太郎', paidDate: '2026-12-11', amount: '1' }),
        row({ employeeNumber: 'E002', paidDate: '2026-07-10', amount: '1' }),
        row({ employeeNumber: 'E003', paidDate: '2026-07-10', amount: '1' }),
      ],
      people,
      [],
    );
    expect(p.rows.map((r) => r.errors)).toEqual([[], ['duplicate'], ['paidDate'], ['amount', 'inKind'], ['nameAmbiguous'], [], [], []]);
    expect(p.rows[1].warnings).toEqual(['titleDiffers']);
    expect(p.rows[5].employee?.id).toBe('a');
    expect(p.rows[6].warnings).toEqual(['beforeHire']);
    expect(p.rows[7].warnings).toEqual(['afterRetire']);
    expect(bonusFixColumns(['duplicate', 'amount'])).toEqual(['employeeNumber', 'paidDate', 'amount']);
  });

  it('ひな形はそのまま読める', () => {
    const p = planBonusImport(bonusCsvTemplate(), [
      { id: 'a', employeeNumber: 'E001', lastName: '山田', firstName: '太郎', hireDate: '2020-01-01', retireDate: null },
      { id: 'b', employeeNumber: 'E002', lastName: '佐藤', firstName: '花子', hireDate: '2020-01-01', retireDate: null },
    ], []);
    expect(p.rows.every((r) => r.status === 'new')).toBe(true);
    expect(p.writes[0].input.inKindAmounts).toEqual({ b: 10000 });
  });
});

describe('planBonusImport：性質の列（年4回以上の賞与。11/19）', () => {
  it('性質は支払日ごとに最初の行。空なら登録済みの性質のまま、新しい支給なら入れない（賞与）', () => {
    const p = planBonusImport(
      [
        H,
        row({ employeeNumber: 'E001', paidDate: '2026-09-25', amount: '100000', nature: '四半期インセンティブ' }),
        row({ employeeNumber: 'E004', paidDate: '2026-09-25', amount: '100000', nature: 'インフレ手当' }),
        row({ employeeNumber: 'E001', paidDate: '2026-12-10', amount: '300000' }),
      ],
      people,
      [{ id: 'x', paidDate: '2026-12-10', title: '冬季賞与', amounts: {}, nature: '決算賞与' }],
    );
    expect(p.rows[1].warnings).toContain('natureDiffers');
    expect(p.writes[0].input.nature).toBe('四半期インセンティブ');
    expect(p.writes[1].input.nature).toBe('決算賞与');
    const plain = planBonusImport([H, row({ employeeNumber: 'E001', paidDate: '2026-07-10', amount: '1' })], people, []);
    expect(plain.writes[0].input.nature).toBeUndefined();
  });
});
