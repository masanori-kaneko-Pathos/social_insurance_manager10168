import type { GradeRow } from '../../../core/models/rates';
import { emptyPayrollInput, Payroll } from '../../../core/models/payroll';
import { PayrollEmployee, PaySchedule } from './payroll-rows';
import {
  decideRegular,
  GradeRows,
  oneGradeException,
  regularYearOf,
  Remuneration,
  RegularInput,
} from './regular';

// ===== 等級表（令和6年3月分から。健保50等級・厚年は健保4〜35級と同じ32等級） =====
const HEALTH_STD = [
  58, 68, 78, 88, 98, 104, 110, 118, 126, 134, 142, 150, 160, 170, 180, 190, 200, 220, 240, 260, 280,
  300, 320, 340, 360, 380, 410, 440, 470, 500, 530, 560, 590, 620, 650, 680, 710, 750, 790, 830, 880,
  930, 980, 1030, 1090, 1150, 1210, 1270, 1330, 1390,
].map((k) => k * 1000);
const HEALTH_MIN = [
  0, 63, 73, 83, 93, 101, 107, 114, 122, 130, 138, 146, 155, 165, 175, 185, 195, 210, 230, 250, 270,
  290, 310, 330, 350, 370, 395, 425, 455, 485, 515, 545, 575, 605, 635, 665, 695, 730, 770, 810, 855,
  905, 955, 1005, 1055, 1115, 1175, 1235, 1295, 1355,
].map((k) => k * 1000);
const healthRows: GradeRow[] = HEALTH_STD.map((standard, i) => ({
  grade: i + 1,
  standard,
  min: HEALTH_MIN[i],
}));
const pensionRows: GradeRow[] = healthRows.slice(3, 35).map((r, i) => ({
  grade: i + 1,
  standard: r.standard,
  min: i === 0 ? 0 : r.min,
}));
const GRADES: GradeRows = { health: healthRows, pension: pensionRows };

// ===== テストデータ =====
const NEXT: PaySchedule = { closingDay: 31, payDay: 25, payMonth: 'next' }; // 月末締め・翌月25日払い
const CURRENT: PaySchedule = { closingDay: 31, payDay: 25, payMonth: 'current' };

function emp(acquiredDate: string, lostDate: string | null = null, pension = true): PayrollEmployee {
  return {
    id: 'A',
    hireDate: acquiredDate,
    retireDate: null,
    health: { enrolled: true, acquiredDate, lostDate },
    pension: { enrolled: pension, acquiredDate: pension ? acquiredDate : null, lostDate },
  };
}

function pay(
  month: string,
  cash: number,
  days = 31,
  retro = 0,
  state: Payroll['state'] = 'normal',
): [string, Payroll] {
  return [
    month,
    {
      ...emptyPayrollInput(),
      officeId: 'o',
      employeeId: 'A',
      paidMonth: month,
      cash,
      fixed: cash,
      days,
      retro,
      state,
    },
  ];
}

// テスト一郎：今は 320,000（健保23級・厚年20級）
const ICHIRO_REM: Remuneration[] = [
  {
    from: '2025-09',
    reason: 'regular',
    monthlyAmount: 320000,
    health: { grade: 23, standard: 320000 },
    pension: { grade: 20, standard: 320000 },
  },
];

function input(over: Partial<RegularInput>): RegularInput {
  return {
    year: 2027,
    employee: emp('2024-04-01'),
    payrolls: new Map(),
    remunerations: ICHIRO_REM,
    grades: GRADES,
    schedule: NEXT,
    ...over,
  };
}

describe('等級表の組み立て（テストの前提）', () => {
  it('340,000 は健保24級・厚年21級', () => {
    expect(healthRows[23]).toEqual({ grade: 24, standard: 340000, min: 330000 });
    expect(pensionRows[20]).toEqual({ grade: 21, standard: 340000, min: 330000 });
    expect(pensionRows.length).toBe(32);
  });
});

describe('decideRegular：予想の練習（テスト一郎）', () => {
  it('330,000・345,000・342,000 → 平均 339,000 → 健保24級・厚年21級（上がる）', () => {
    const r = decideRegular(
      input({
        payrolls: new Map([pay('2027-04', 330000), pay('2027-05', 345000, 30), pay('2027-06', 342000)]),
      }),
    );
    expect(r.status).toBe('decided');
    expect(r.average).toBe(339000);
    expect(r.next?.health).toEqual({ grade: 24, standard: 340000 });
    expect(r.next?.pension).toEqual({ grade: 21, standard: 340000 });
    expect(r.current?.health.grade).toBe(23);
    expect(r.change).toBe('up');
  });

  it('5月に遡及支払 5,000 → 修正平均 337,333（標準報酬は同じ 340,000）', () => {
    const r = decideRegular(
      input({
        payrolls: new Map([
          pay('2027-04', 330000),
          pay('2027-05', 345000, 30, 5000),
          pay('2027-06', 342000),
        ]),
      }),
    );
    expect(r.rawAverage).toBe(339000);
    expect(r.average).toBe(337333);
    expect(r.hasRetro).toBeTrue();
    expect(r.next?.health.standard).toBe(340000);
  });
});

describe('decideRegular：使う月', () => {
  it('17日未満の月は除いて平均', () => {
    const r = decideRegular(
      input({
        payrolls: new Map([pay('2027-04', 300000), pay('2027-05', 150000, 15), pay('2027-06', 320000)]),
      }),
    );
    expect(r.months.map((m) => m.skip)).toEqual([null, 'shortDays', null]);
    expect(r.usedCount).toBe(2);
    expect(r.average).toBe(310000);
  });

  it('3か月とも17日未満 → 従前のまま（keep）', () => {
    const r = decideRegular(
      input({
        payrolls: new Map([pay('2027-04', 0, 0), pay('2027-05', 0, 0), pay('2027-06', 0, 0)]),
      }),
    );
    expect(r.status).toBe('keep');
    expect(r.next?.health.grade).toBe(23);
    expect(r.change).toBe('same');
  });

  it('実績のない月がある → incomplete（決めない）', () => {
    const r = decideRegular(input({ payrolls: new Map([pay('2027-04', 300000), pay('2027-06', 300000)]) }));
    expect(r.status).toBe('incomplete');
    expect(r.months[1].skip).toBe('noRecord');
  });

  it('当月払い・4/10 取得：4月は1か月分ないので除く', () => {
    const r = decideRegular(
      input({
        employee: emp('2027-04-10'),
        schedule: CURRENT,
        remunerations: [],
        payrolls: new Map([pay('2027-04', 200000, 21), pay('2027-05', 300000), pay('2027-06', 300000)]),
      }),
    );
    expect(r.months[0].skip).toBe('partialAcquisition');
    expect(r.average).toBe(300000);
    expect(r.change).toBeNull(); // 従前がない
  });
});

describe('decideRegular：休職の月', () => {
  it('低額の休職給の月（休職）は除く', () => {
    const r = decideRegular(
      input({
        payrolls: new Map([
          pay('2027-04', 320000),
          pay('2027-05', 60000, 30, 0, 'suspended'),
          pay('2027-06', 320000),
        ]),
      }),
    );
    expect(r.months[1].skip).toBe('suspended');
    expect(r.average).toBe(320000);
  });
});

describe('oneGradeException（資料の金額と一致するか）', () => {
  it('厚年：66.5万円以上 と 60.5万〜63.5万円未満', () => {
    expect(oneGradeException(pensionRows, 665000, 605000)).toBeTrue();
    expect(oneGradeException(pensionRows, 634999, 665000)).toBeTrue();
    expect(oneGradeException(pensionRows, 664999, 605000)).toBeFalse();
    expect(oneGradeException(pensionRows, 665000, 635000)).toBeFalse();
  });
  it('健保：5.3万円未満 と 6.3万〜7.3万円未満', () => {
    expect(oneGradeException(healthRows, 52999, 63000)).toBeTrue();
    expect(oneGradeException(healthRows, 53000, 63000)).toBeFalse();
    expect(oneGradeException(healthRows, 52999, 73000)).toBeFalse();
  });
});

describe('decideRegular：対象外', () => {
  it('6月1日以降の取得', () => {
    expect(decideRegular(input({ employee: emp('2027-06-01') })).excluded).toBe('acquiredFromJune');
  });
  it('7月1日より前に喪失', () => {
    expect(decideRegular(input({ employee: emp('2020-04-01', '2027-07-01') })).excluded).toBe(
      'notInsured',
    );
  });
  it('7月1日に喪失（6/30退職）でも対象外、7/2喪失なら対象', () => {
    expect(decideRegular(input({ employee: emp('2020-04-01', '2027-07-02') })).excluded).toBeNull();
  });
  it('8月に随時改定がある', () => {
    const rem: Remuneration[] = [
      ...ICHIRO_REM,
      { ...ICHIRO_REM[0], from: '2027-08', reason: 'irregular' },
    ];
    expect(decideRegular(input({ remunerations: rem })).excluded).toBe('irregular');
  });
});

describe('decideRegular：厚年の資格がない人（70歳以上など）', () => {
  it('健保の等級だけ出す', () => {
    const r = decideRegular(
      input({
        employee: emp('2018-04-01', null, false),
        payrolls: new Map([pay('2027-04', 200000), pay('2027-05', 200000, 30), pay('2027-06', 200000)]),
      }),
    );
    expect(r.next?.health.standard).toBe(200000);
    expect(r.next?.pension).toBeNull();
  });
});

describe('decideRegular：年間平均の候補', () => {
  function seasonal(normal: number, rest: number): Map<string, Payroll> {
    const m = new Map<string, Payroll>();
    for (const mm of ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']) {
      m.set(...pay(mm, rest));
    }
    for (const mm of ['2027-04', '2027-05', '2027-06']) m.set(...pay(mm, normal));
    return m;
  }

  it('4〜6月だけ高い（330,000、ほかは 250,000）→ 年間平均 270,000 で3等級差 → 候補', () => {
    const r = decideRegular(input({ payrolls: seasonal(330000, 250000) }));
    expect(r.next?.health.grade).toBe(24);
    expect(r.annual?.average).toBe(270000);
    expect(r.annual?.next.health.grade).toBe(21);
    expect(r.annual?.healthDiff).toBe(3);
    expect(r.annual?.pensionDiff).toBe(3);
    expect(r.annual?.candidate).toBeTrue();
    expect(r.annual?.incomplete).toBeFalse();
  });

  it('差が1等級 → 候補ではない', () => {
    const r = decideRegular(input({ payrolls: seasonal(330000, 315000) }));
    expect(r.annual?.candidate).toBeFalse();
    expect(r.annual?.exception).toBeFalse();
  });

  it('健保の上限：通常 1,450,000（50級）・年間 1,315,000（49級）→ 1等級差の例外で候補', () => {
    const r = decideRegular(input({ payrolls: seasonal(1450000, 1270000) }));
    expect(r.next?.health.grade).toBe(50);
    expect(r.annual?.average).toBe(1315000);
    expect(r.annual?.next.health.grade).toBe(49);
    expect(r.annual?.exception).toBeTrue();
    expect(r.annual?.candidate).toBeTrue();
  });

  it('健保の上限：通常 1,400,000 は 141.5万円に届かないので例外ではない', () => {
    const r = decideRegular(input({ payrolls: seasonal(1400000, 1270000) }));
    expect(r.annual?.next.health.grade).toBe(49);
    expect(r.annual?.exception).toBeFalse();
    expect(r.annual?.candidate).toBeFalse();
  });

  it('健保の下限：通常 50,000（1級）・年間 65,000（2級）→ 例外で候補', () => {
    const r = decideRegular(input({ payrolls: seasonal(50000, 70000) }));
    expect(r.annual?.average).toBe(65000);
    expect(r.annual?.healthDiff).toBe(-1);
    expect(r.annual?.exception).toBeTrue();
  });

  it('4月に資格取得した人は年間平均の対象外', () => {
    const r = decideRegular(
      input({
        employee: emp('2027-04-01'),
        remunerations: [],
        payrolls: new Map([pay('2027-04', 300000), pay('2027-05', 300000, 30), pay('2027-06', 300000)]),
      }),
    );
    expect(r.status).toBe('decided');
    expect(r.annual).toBeNull();
  });

  it('前年の実績がない月があれば incomplete の印（あるだけで計算）', () => {
    const r = decideRegular(
      input({
        payrolls: new Map([pay('2027-04', 300000), pay('2027-05', 300000, 30), pay('2027-06', 300000)]),
      }),
    );
    expect(r.annual?.usedCount).toBe(3);
    expect(r.annual?.incomplete).toBeTrue();
  });
});

describe('regularYearOf', () => {
  it('6月払いが済んでいれば今年', () => {
    expect(regularYearOf('2026-10')).toBe(2026);
    expect(regularYearOf('2026-06')).toBe(2026);
    expect(regularYearOf('2027-05')).toBe(2026);
  });
});
