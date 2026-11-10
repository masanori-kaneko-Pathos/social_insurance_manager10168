import { emptyPayrollInput, Payroll } from '../../../core/models/payroll';
import { parseCsv, toCsv } from '../../../shared/csv/csv';
import { buildPayrollCsv, classifyImport, CsvEmployee, makeMatcher, mapHeader, parseFlag, parseMonth, parseState, payrollFileName, readPayrollCsv } from './payroll-csv';
import { monthsBetween } from '../../../shared/utils/date';
import { PaySchedule } from './payroll-rows';

const S: PaySchedule = { closingDay: 31, payDay: 25, payMonth: 'next' };

function emp(id: string, no: string | null, last: string, hire: string, retire: string | null = null): CsvEmployee {
  const en = { enrolled: true, acquiredDate: hire, lostDate: null };
  return {
    id,
    employeeNumber: no,
    lastName: last,
    firstName: '太郎',
    hireDate: hire,
    retireDate: retire,
    health: { ...en },
    pension: { ...en },
  };
}

const A = emp('A', '0012', 'テスト一', '2024-04-01');
const B = emp('B', 'E-2', 'テスト二', '2024-04-01');
const D = emp('D', '0040', 'テスト四', '2020-04-01', '2026-08-20');
const EMPS = [A, B, D];

const HEADER = '社員番号,氏名,支払った月,支払額,固定的賃金,支払基礎日数';

describe('mapHeader', () => {
  it('日本語・英語・並び順は自由・知らない列は無視', () => {
    const r = mapHeader(['Month paid', 'メモ', '社員番号', 'Paid in money', '固定的賃金', 'Payment basis days']);
    expect(r.missing).toEqual([]);
    expect(r.index.paidMonth).toBe(0);
    expect(r.index.employeeNumber).toBe(2);
  });
  it('必須の列がない', () => {
    expect(mapHeader(['社員番号', '支払額']).missing).toEqual(['paidMonth', 'fixed', 'days']);
  });
});

describe('parseMonth（Excel で変わった形も読む）', () => {
  it('いろいろな形', () => {
    for (const s of ['2026-10', '2026/10', '2026/10/1', '2026-10-01', '2026年10月', '202610', '２０２６／１０']) {
      expect(parseMonth(s)).toBe('2026-10');
    }
    expect(parseMonth('2026/1')).toBe('2026-01');
  });
  it('読めない', () => {
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('Oct-26')).toBeNull();
    expect(parseMonth('')).toBeNull();
  });
});

describe('parseFlag / parseState', () => {
  it('日割り', () => {
    expect(parseFlag('')).toBeFalse();
    expect(parseFlag('○')).toBeTrue();
    expect(parseFlag('1')).toBeTrue();
    expect(parseFlag('たぶん')).toBeUndefined();
  });
  it('状態', () => {
    expect(parseState('')).toBe('normal');
    expect(parseState('休職')).toBe('suspended');
    expect(parseState('Temporary layoff')).toBe('furlough');
    expect(parseState('病欠')).toBeUndefined();
  });
});

describe('makeMatcher（社員番号の照合）', () => {
  const m = makeMatcher(EMPS);
  it('そのまま一致', () => {
    expect(m('0012')).toEqual({ kind: 'ok', employee: A, zeroPadded: false });
    expect(m('E-2')).toEqual({ kind: 'ok', employee: B, zeroPadded: false });
  });
  it('Excel で先頭の0が消えた「12」も、1人だけなら一致（印つき）', () => {
    expect(m('12')).toEqual({ kind: 'ok', employee: A, zeroPadded: true });
  });
  it('見つからない', () => {
    expect(m('99')).toEqual({ kind: 'none' });
  });
  it('先頭の0を落とすと2人あたる → ambiguous', () => {
    const m2 = makeMatcher([A, emp('X', '012', 'テストX', '2024-04-01')]);
    expect(m2('12')).toEqual({ kind: 'ambiguous' });
  });
});

describe('readPayrollCsv', () => {
  const read = (body: string) => readPayrollCsv(parseCsv(`${HEADER}\n${body}`), EMPS, S);

  it('正しい行を読む（Excel の形のまま）', () => {
    // 10月払い ＝ 9月分（30日）
    const r = read('12,テスト 一郎,2026/10/1,"330,000",300000,30');
    expect(r.errors).toEqual([]);
    expect(r.zeroPadded).toEqual([2]);
    expect(r.items).toEqual([
      {
        line: 2,
        employeeId: 'A',
        employeeLabel: '0012 テスト一 太郎',
        paidMonth: '2026-10',
        input: { ...emptyPayrollInput(), cash: 330000, fixed: 300000, days: 30 },
      },
    ]);
  });

  it('行番号つきのエラー（人・月・数字・在籍・重複）', () => {
    const r = read(
      [
        ',,2026-10,1,1,1', // 2: 社員番号なし
        '99,,2026-10,1,1,1', // 3: 未登録
        '0012,,2026-13,1,1,1', // 4: 月が読めない
        '0012,,2026-10,100,200,30', // 5: 固定 > 通貨
        '0040,,2026-10,1,1,1', // 6: 四郎は10月払い（9月分）に在籍していない
        '0012,,2026-09,1,1,30', // 7: OK
        '0012,,2026-09,1,1,30', // 8: 重複
      ].join('\n'),
    );
    expect(r.errors).toEqual([
      { line: 2, codes: ['noEmployeeNumber'] },
      { line: 3, codes: ['unknownEmployee'] },
      { line: 4, codes: ['badMonth'] },
      { line: 5, codes: ['fixedOverCash'] },
      { line: 6, codes: ['notEmployed'] },
      { line: 8, codes: ['duplicate'] },
    ]);
    expect(r.items.map((x) => x.line)).toEqual([7]);
  });

  it('10月払い ＝ 9月分なので、日数31はエラー（電気代の請求書のわな）', () => {
    expect(read('0012,,2026-10,1,1,31').errors).toEqual([{ line: 2, codes: ['daysOutOfRange'] }]);
  });

  it('四郎の 9月払い（8/1〜8/20）は日数20まで', () => {
    const ok = read('0040,,2026-09,200000,200000,20');
    expect(ok.errors).toEqual([]);
  });

  it('数字が空でも、社員番号が未登録ならエラー', () => {
    expect(read('99,,2026-10,,,').errors).toEqual([{ line: 2, codes: ['unknownEmployee'] }]);
  });

  it('空の行は読み飛ばす', () => {
    expect(read('\n,,,,,\n0012,,2026-10,1,1,31').blankLines).toBe(2);
  });

  it('必須の列がなければ何も読まない', () => {
    const r = readPayrollCsv(parseCsv('社員番号,支払額\n0012,1'), EMPS, S);
    expect(r.missingColumns).toEqual(['paidMonth', 'fixed', 'days']);
    expect(r.items).toEqual([]);
  });
});

describe('classifyImport', () => {
  it('新規・上書き・変わらない', () => {
    const r = readPayrollCsv(
      parseCsv(`${HEADER}\n0012,,2026-09,1,1,30\n0012,,2026-10,2,2,30\nE-2,,2026-10,3,3,30`),
      EMPS,
      S,
    );
    const saved = (id: string, m: string, n: number, d: number): [string, Payroll] => [
      `${id}|${m}`,
      { ...emptyPayrollInput(), officeId: 'o', employeeId: id, paidMonth: m, cash: n, fixed: n, days: d },
    ];
    const c = classifyImport(r.items, new Map([saved('A', '2026-09', 1, 30), saved('A', '2026-10', 9, 30)]));
    expect(c.unchanged.map((x) => x.line)).toEqual([2]);
    expect(c.updated.map((x) => x.line)).toEqual([3]);
    expect(c.created.map((x) => x.line)).toEqual([4]);
  });
});

describe('書き出し → 取り込み（往復）', () => {
  const saved: Payroll[] = [
    {
      ...emptyPayrollInput(),
      officeId: 'o',
      employeeId: 'A',
      paidMonth: '2026-09',
      cash: 330000,
      fixed: 300000,
      inKind: 12000,
      retro: 5000,
      days: 30,
      absentDays: 1,
      workMinutes: 9630,
      prorated: true,
      state: 'suspended',
    },
  ];

  it('書き出しの形：期間に在籍していた人だけ、未入力は空欄', () => {
    const rows = buildPayrollCsv(EMPS, saved, monthsBetween('2026-09', '2026-10'), S, 'ja');
    expect(rows[0]).toEqual([
      '社員番号', '氏名', '支払った月', '支払額', '固定的賃金', '支払基礎日数',
      '現物', '遡及支払額', '欠勤日数', '実労働時間', '日割り', '状態',
    ]);
    // 9月払い：一郎（入力済み）・二郎（空）・四郎（8月分に在籍）／10月払い：一郎・二郎
    expect(rows.slice(1).map((r) => `${r[0]}|${r[2]}`)).toEqual([
      '0012|2026-09', 'E-2|2026-09', '0040|2026-09', '0012|2026-10', 'E-2|2026-10',
    ]);
    expect(rows[1]).toEqual([
      '0012', 'テスト一 太郎', '2026-09', '330000', '300000', '30', '12000', '5000', '1', '160:30', '1', '休職',
    ]);
    expect(rows[2].slice(3)).toEqual(['', '', '', '', '', '', '', '', '']);
  });

  it('書き出したものをそのまま取り込むと、入力済みの行は「変わらない」、空の行は未記入として読み飛ばす', () => {
    for (const lang of ['ja', 'en'] as const) {
      const csv = toCsv(buildPayrollCsv(EMPS, saved, ['2026-09'], S, lang));
      const r = readPayrollCsv(parseCsv(csv), EMPS, S);
      expect(r.items.length).toBe(1);
      const c = classifyImport(r.items, new Map([['A|2026-09', saved[0]]]));
      expect(c.unchanged.length).toBe(1);
      expect(r.errors).toEqual([]);
      expect(r.unfilledLines).toBe(2); // 空欄の二郎・四郎
    }
  });
});

describe('payrollFileName', () => {
  it('期間と作った日', () => {
    expect(payrollFileName('伊藤テスト中商事', '2026-04', '2026-06', '2026-11-06', 'ja')).toBe(
      '給与の実績_伊藤テスト中商事_2026-04〜2026-06_20261106.csv',
    );
    expect(payrollFileName('X', '2026-10', '2026-10', '2026-11-06', 'en')).toBe('payroll_X_2026-10_20261106.csv');
  });
});
