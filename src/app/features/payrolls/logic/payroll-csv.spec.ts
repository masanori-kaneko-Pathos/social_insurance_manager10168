import { emptyPayrollInput, Payroll } from '../../../core/models/payroll';
import { parseCsv, toCsv } from '../../../shared/csv/csv';
import { guessMapping, missingRequired, toOurTable } from '../../../shared/import/column-map';
import { buildPayrollCsv, exportLineNames, lineHeaderOf, splitLineHeader, classifyImport, isInKindMerged, CsvEmployee, makeMatcher, PAYROLL_IMPORT_FIELDS, PAYROLL_TABLE_SPEC, mapHeader, parseFlag, parseMonth, parseState, payrollFileName, readPayrollCsv } from './payroll-csv';
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
  it('今の見出し（明細の言葉）でも、前の見出しでも読める（11/24）', () => {
    const now = mapHeader(['社員番号', '支払月', '総支給額', 'うち固定的賃金', '支払基礎日数', 'うち昇給差額', '1か月分そろわない月']);
    const old = mapHeader(['社員番号', '支払った月', '支払額', '固定的賃金', '支払基礎日数', '遡及支払額', '日割り']);
    for (const r of [now, old]) {
      expect(r.missing).toEqual([]);
      expect(r.index.cash).toBe(2);
      expect(r.index.retro).toBe(5);
      expect(r.index.prorated).toBe(6);
    }
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

  describe('社員番号が空の行は氏名で照合する（社員番号は任意の項目）', () => {
    const NAMED: CsvEmployee[] = [
      { ...EMPS[0], id: 'N1', employeeNumber: null, lastName: '番号', firstName: 'なし子' },
      { ...EMPS[0], id: 'N2', employeeNumber: null, lastName: '同姓', firstName: '同名' },
      { ...EMPS[0], id: 'N3', employeeNumber: null, lastName: '同姓', firstName: '同名' },
    ];
    const readN = (body: string) => readPayrollCsv(parseCsv(HEADER + '\n' + body), [...EMPS, ...NAMED], S);

    it('氏名で1人に決まれば、その人（空白・全角半角の違いは無視）', () => {
      const r = readN(',番号　なし子,2026-10,200000,200000,30');
      expect(r.errors).toEqual([]);
      expect(r.items.map((x) => x.employeeId)).toEqual(['N1']);
    });

    it('同じ氏名が2人なら、社員番号を入れてもらう', () => {
      expect(readN(',同姓 同名,2026-10,1,1,1').errors).toEqual([{ line: 2, codes: ['ambiguousName'] }]);
    });

    it('番号も氏名も決まらない行：数字があればエラー、数字が空なら読み飛ばす', () => {
      expect(readN(',いない 人,2026-10,1,1,1').errors).toEqual([{ line: 2, codes: ['unknownName'] }]);
      const blank = readN(',いない 人,2026-10,,,\n,,2026-10,,,\n,同姓 同名,2026-10,,,');
      expect(blank.errors).toEqual([]);
      expect(blank.unfilledLines).toBe(3);
    });

    it('社員番号の列がないファイルも、氏名の列で照合できる（列を合わせる画面）', () => {
      const table = [['氏名', '支給日', '総支給額', '固定給', '出勤日数'], ['番号 なし子', '2026/10/25', '200,000', '200000', '30']];
      const m = guessMapping(table[0], PAYROLL_IMPORT_FIELDS);
      expect(missingRequired(PAYROLL_IMPORT_FIELDS, m)).toEqual([]);
      const r = readPayrollCsv(toOurTable(table, m, PAYROLL_TABLE_SPEC), [...EMPS, ...NAMED], S);
      expect(r.errors).toEqual([]);
      expect(r.items.map((x) => [x.employeeId, x.paidMonth, x.input.cash])).toEqual([['N1', '2026-10', 200000]]);
    });

    it('書き出したファイル（番号のない人は氏名だけ）をそのまま取り込める', () => {
      const r = readN(',番号 なし子,2026-10,,,');
      expect(r.errors).toEqual([]);
      expect(r.unfilledLines).toBe(1);
    });
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
      '社員番号', '氏名', '支払月', '通貨によるものの額', 'うち固定的賃金', '給与計算の基礎日数',
      '現物によるものの額', 'うち遡及支払額', '欠勤日数', '実労働時間', '日割りの月', '状態',
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
      '給与_伊藤テスト中商事_2026-04〜2026-06_20261106.csv',
    );
    expect(payrollFileName('X', '2026-10', '2026-10', '2026-11-06', 'en')).toBe('payroll_X_2026-10_20261106.csv');
  });
});

describe('前の見出し（評価用の CSV・前に書き出したファイル）も読める（11/24 夕方に届書の欄の名前へ）', () => {
  it('支払額・固定的賃金・支払基礎日数・現物・遡及支払額・日割り／総支給額・うち昇給差額・1か月分そろわない月', () => {
    for (const h of [
      ['社員番号', '支払った月', '支払額', '固定的賃金', '支払基礎日数', '現物', '遡及支払額', '日割り'], // 評価用（1117-200）
      ['社員番号', '支払月', '総支給額', 'うち固定的賃金', '支払基礎日数', '現物', 'うち昇給差額', '1か月分そろわない月'],
    ]) {
      const m = mapHeader(h);
      expect(m.missing).toEqual([]);
      expect(['cash', 'fixed', 'days', 'inKind', 'retro', 'prorated'].every((c) => (m.index as Record<string, number | undefined>)[c] !== undefined)).toBeTrue();
    }
  });
});

describe('現物の「内訳なし」', () => {
  it('現物の欄に「内訳なし」と書いた行は null で読む', () => {
    const r = readPayrollCsv(parseCsv(`${HEADER},現物\n12,テスト 一郎,2026-10,330000,300000,30,内訳なし`), EMPS, S);
    expect(r.errors).toEqual([]);
    expect(r.hasInKindColumn).toBeTrue();
    expect(r.items[0].input.inKind).toBeNull();
  });
  it('現物の列がないファイル：選ばなければ 0、「支払額に含まれている」なら null', () => {
    const t = parseCsv(`${HEADER}\n12,テスト 一郎,2026-10,330000,300000,30`);
    const zero = readPayrollCsv(t, EMPS, S);
    expect(zero.hasInKindColumn).toBeFalse();
    expect(zero.items[0].input.inKind).toBe(0);
    expect(readPayrollCsv(t, EMPS, S, { inKindMissing: 'merged' }).items[0].input.inKind).toBeNull();
  });
  it('書き出しは「内訳なし」、読み直すと null に戻る（往復）', () => {
    const p: Payroll = {
      ...emptyPayrollInput(),
      cash: 330000,
      fixed: 300000,
      days: 30,
      inKind: null,
      officeId: 'o',
      employeeId: 'A',
      paidMonth: '2026-10',
    };
    const rows = buildPayrollCsv([A], [p], ['2026-10'], S, 'ja');
    expect(rows[1][rows[0].indexOf('現物によるものの額')]).toBe('内訳なし');
    expect(readPayrollCsv(rows, [A], S).items[0].input.inKind).toBeNull();
  });
  it('isInKindMerged：全角・英語も受け付ける', () => {
    expect(isInKindMerged(' 内訳なし ')).toBeTrue();
    expect(isInKindMerged('Included in pay')).toBeTrue();
    expect(isInKindMerged('0')).toBeFalse();
  });
});

describe('内訳の列（11/24）', () => {
  const rows = (text: string) => parseCsv(text);

  it('見出しが給与の項目名の列は内訳として読む。総支給額・毎月決まった額の列がなくてもよい（課税・非課税の通勤手当は分けたまま）', () => {
    const r = readPayrollCsv(
      rows('社員番号,支払月,支払基礎日数,基本給,非課税通勤手当,課税通勤手当,欠勤控除,メモ\n0012,2026-10,30,300000,10000,60000,5000,何か'),
      EMPS,
      S,
    );
    expect(r.missingColumns).toEqual([]);
    expect(r.errors).toEqual([]);
    const it0 = r.items[0].input;
    expect(it0.cash).toBe(365000);
    expect(it0.fixedFull).toBe(370000);
    expect(it0.lines?.map((l) => `${l.name}:${l.category}`)).toEqual([
      '基本給:base',
      '非課税通勤手当:commute',
      '課税通勤手当:commute',
      '欠勤控除:deduction',
    ]);
  });

  it('総支給額の列もあれば、内訳の合計と合うかを見る', () => {
    const r = readPayrollCsv(rows('社員番号,支払月,総支給額,支払基礎日数,基本給,通勤手当\n0012,2026-10,320000,30,300000,10000'), EMPS, S);
    expect(r.errors[0].codes).toContain('linesMismatch');
  });

  it('内訳の列の金額が空の行は、今までどおり総支給額の列から読む（内訳なし）', () => {
    const r = readPayrollCsv(rows('社員番号,支払月,総支給額,うち毎月決まった額,支払基礎日数,基本給\n0012,2026-10,300000,300000,30,'), EMPS, S);
    expect(r.items[0].input.lines).toBeNull();
    expect(r.items[0].input.cash).toBe(300000);
  });

  it('書き出し → 取り込みで内訳ごと戻る（ひな形の列 → 保存済みの内訳の順）', () => {
    const lines = [
      { name: '基本給', category: 'base' as const, amount: 300000 },
      { name: '非課税通勤手当', category: 'commute' as const, amount: 10000 },
    ];
    const saved: Payroll[] = [
      { ...emptyPayrollInput(), officeId: 'o', employeeId: 'A', paidMonth: '2026-10', cash: 310000, fixed: 310000, fixedFull: 310000, days: 30, lines },
    ];
    const names = exportLineNames(saved, ['基本給', '固定残業手当']);
    expect(names).toEqual(['基本給', '固定残業手当', '非課税通勤手当']);
    const out = buildPayrollCsv([A], saved, ['2026-10'], S, 'ja', names);
    const back = readPayrollCsv(out, EMPS, S);
    expect(back.errors).toEqual([]);
    expect(back.items[0].input.lines).toEqual(lines);
    expect(classifyImport(back.items, new Map([['A|2026-10', saved[0]]])).unchanged.length).toBe(1);
  });

  it('列を合わせる画面：給与の項目名の列は、結ばなくても後ろに付けて残す', () => {
    const t = toOurTable(
      [['従業員コード', '支給年月', '総支給額', '固定給', '出勤日数', '基本給', '謎の列']],
      { employeeNumber: { col: 0 }, paidMonth: { col: 1 }, cash: { col: 2 }, fixed: { col: 3 }, days: { col: 4 } },
      { ...PAYROLL_TABLE_SPEC, passThrough: (h) => h === '基本給' },
    );
    expect(t[0].slice(-1)).toEqual(['基本給']);
  });
});

describe('本来の月の列（見出しの [YYYY-MM]。払い忘れ・計算誤りの精算。11/24）', () => {
  it('splitLineHeader・lineHeaderOf：半角・全角の括弧を読み、書き出しは半角', () => {
    expect(splitLineHeader('家族手当[2026-04]')).toEqual({ name: '家族手当', forMonth: '2026-04' });
    expect(splitLineHeader('家族手当 ［2026-04］')).toEqual({ name: '家族手当', forMonth: '2026-04' });
    expect(splitLineHeader('家族手当')).toEqual({ name: '家族手当', forMonth: null });
    expect(lineHeaderOf('家族手当', '2026-04')).toBe('家族手当[2026-04]');
    expect(lineHeaderOf('家族手当', null)).toBe('家族手当');
  });

  const H = '社員番号,氏名,支払月,通貨によるものの額,うち固定的賃金,給与計算の基礎日数,基本給,家族手当,家族手当[2026-09]';

  it('取り込み：本来の月の列は、その月の行として読む（この月の固定的賃金には入れない）', () => {
    const r = readPayrollCsv(parseCsv(`${H}\n0012,テスト一 太郎,2026-10,,,30,200000,10000,10000`), EMPS, S);
    const it = r.items[0];
    expect(r.errors).toEqual([]);
    expect(it.input.cash).toBe(220000);
    expect(it.input.fixed).toBe(210000);
    expect(it.input.lines).toEqual([
      { name: '基本給', category: 'base', amount: 200000 },
      { name: '家族手当', category: 'fixedAllowance', amount: 10000 },
      { name: '家族手当', category: 'fixedAllowance', amount: 10000, forMonth: '2026-09' },
    ]);
  });

  it('取り込み：本来の月が支払月と同じか後ならエラー', () => {
    const h = H.replace('[2026-09]', '[2026-10]');
    const r = readPayrollCsv(parseCsv(`${h}\n0012,テスト一 太郎,2026-10,,,30,200000,10000,10000`), EMPS, S);
    expect(r.errors[0].codes).toContain('badForMonth');
  });

  it('書き出し → 取り込み（往復）：本来の月の行は [YYYY-MM] の列に出て、読み直すと戻る', () => {
    const p: Payroll = {
      ...emptyPayrollInput(),
      cash: 220000,
      fixed: 210000,
      days: 30,
      lines: [
        { name: '基本給', category: 'base', amount: 200000 },
        { name: '家族手当', category: 'fixedAllowance', amount: 10000 },
        { name: '家族手当', category: 'fixedAllowance', amount: 10000, forMonth: '2026-09' },
      ],
      fixedFull: 210000,
      officeId: 'o',
      employeeId: 'A',
      paidMonth: '2026-10',
    };
    const names = exportLineNames([p], null);
    expect(names).toEqual(['基本給', '家族手当', '家族手当[2026-09]']);
    const rows = buildPayrollCsv([A], [p], ['2026-10'], S, 'ja', names);
    expect(rows[1].slice(-3)).toEqual(['200000', '10000', '10000']);
    expect(readPayrollCsv(rows, [A], S).items[0].input.lines).toEqual(p.lines);
  });
});
