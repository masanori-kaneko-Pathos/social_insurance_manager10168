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

  it('翌月払い・4/1 取得：4月払い（3月分）は入社前なので未入力ではなく除く → 5・6月で平均（11/20）', () => {
    const r = decideRegular(
      input({
        employee: emp('2027-04-01'),
        remunerations: [],
        payrolls: new Map([pay('2027-05', 240000), pay('2027-06', 250000)]),
      }),
    );
    expect(r.months[0].skip).toBe('beforeAcquisition');
    expect(r.status).toBe('decided');
    expect(r.average).toBe(245000);
  });

  it('翌月払い・3/1 取得で4月払いがない → 入社後の月なので未入力（incomplete）のまま', () => {
    const r = decideRegular(
      input({ employee: emp('2027-03-01'), remunerations: [], payrolls: new Map([pay('2027-05', 240000), pay('2027-06', 250000)]) }),
    );
    expect(r.months[0].skip).toBe('noRecord');
    expect(r.status).toBe('incomplete');
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
  it('7月に特例改定がある（11/16）', () => {
    const rem: Remuneration[] = [
      ...ICHIRO_REM,
      { ...ICHIRO_REM[0], from: '2027-07', reason: 'special' },
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

describe('decideRegular：支払基礎日数の基準（年金機構「定時決定」5・6。R47。11/16）', () => {
  const months = (d4: number, d5: number, d6: number) =>
    new Map([pay('2027-04', 300000, d4), pay('2027-05', 330000, d5), pay('2027-06', 360000, d6)]);

  it('一般：17日以上の月だけ（16日の月は外す）', () => {
    const r = decideRegular(input({ payrolls: months(20, 16, 20) }));
    expect(r.months.map((m) => m.used)).toEqual([true, false, true]);
    expect(r.months[1].skip).toBe('shortDays');
    expect(r.months[1].minDays).toBe(17);
    expect(r.average).toBe(330000);
  });

  it('特定適用事業所の短時間労働者：11日以上の月を使う', () => {
    const r = decideRegular(input({ payrolls: months(12, 10, 11), minDaysAt: () => 11 }));
    expect(r.months.map((m) => m.used)).toEqual([true, false, true]);
    expect(r.months[1].minDays).toBe(11);
    expect(r.average).toBe(330000);
  });

  it('パート：17日以上の月が1か月でもあれば、その月だけ', () => {
    const r = decideRegular(input({ payrolls: months(17, 15, 16), partAt: () => true }));
    expect(r.months.map((m) => m.used)).toEqual([true, false, false]);
    expect(r.average).toBe(300000);
  });

  it('パート：17日以上がなければ、15日以上17日未満の月', () => {
    const r = decideRegular(input({ payrolls: months(16, 14, 15), partAt: () => true }));
    expect(r.months.map((m) => m.used)).toEqual([true, false, true]);
    expect(r.months[1].minDays).toBe(15);
    expect(r.average).toBe(330000);
    expect(r.status).toBe('decided');
  });

  it('パート：どれも15日未満なら従前のまま（keep）', () => {
    const r = decideRegular(input({ payrolls: months(14, 14, 10), partAt: () => true }));
    expect(r.status).toBe('keep');
    expect(r.next).toEqual(r.current);
  });

  it('パートでない人に15日の読み替えはしない', () => {
    expect(decideRegular(input({ payrolls: months(16, 15, 16) })).status).toBe('keep');
  });
});

describe('decideRegular：賞与に係る報酬（年4回以上の賞与。11/19）', () => {
  it('各月の報酬に 年額÷12 を足して平均する（300,000 ＋ 70,000 → 370,000 → 健保26級）', () => {
    const payrolls = new Map([pay('2027-04', 300000), pay('2027-05', 300000, 30), pay('2027-06', 300000)]);
    const r = decideRegular(input({ payrolls, bonusMonthly: 70000 }));
    expect(r.bonusMonthly).toBe(70000);
    expect(r.months.map((m) => m.amount)).toEqual([370000, 370000, 370000]);
    expect(r.average).toBe(370000);
    expect(r.next?.health).toEqual({ grade: 26, standard: 380000 });
  });

  it('足さなければ今までどおり（bonusMonthly は 0）', () => {
    const payrolls = new Map([pay('2027-04', 300000), pay('2027-05', 300000, 30), pay('2027-06', 300000)]);
    const r = decideRegular(input({ payrolls }));
    expect(r.bonusMonthly).toBe(0);
    expect(r.average).toBe(300000);
  });
});

describe('decideRegular：一時帰休（休業手当。ガイドブック。11/19）', () => {
  const furlough = (m: string, cash: number): [string, Payroll] => {
    const [k, p] = pay(m, cash);
    return [k, { ...p, state: 'furlough' }];
  };
  it('7/1までに解消（6月はふつう）：休業手当の月を除いて平均', () => {
    const r = decideRegular(input({ payrolls: new Map([furlough('2027-04', 200000), pay('2027-05', 330000, 30), pay('2027-06', 342000)]) }));
    expect(r.months[0].skip).toBe('furloughResolved');
    expect(r.usedCount).toBe(2);
    expect(r.average).toBe(336000);
  });
  it('解消していない（6月も一時帰休）：休業手当を含めて平均', () => {
    const r = decideRegular(input({ payrolls: new Map([furlough('2027-04', 200000), furlough('2027-05', 210000), furlough('2027-06', 220000)]) }));
    expect(r.usedCount).toBe(3);
    expect(r.average).toBe(210000);
  });
  it('6月の給与は休業手当でも、7月に払った給与がふつうなら7/1に解消（事例集 5(1) 問3・4）。4〜6月とも休業手当なら従前のまま（問7）', () => {
    const r = decideRegular(
      input({ payrolls: new Map([furlough('2027-04', 200000), pay('2027-05', 330000, 30), furlough('2027-06', 220000), pay('2027-07', 340000)]) }),
    );
    expect(r.usedCount).toBe(1);
    expect(r.average).toBe(330000);
    const all = decideRegular(
      input({ payrolls: new Map([furlough('2027-04', 200000), furlough('2027-05', 210000), furlough('2027-06', 220000), pay('2027-07', 340000)]) }),
    );
    expect(all.status).toBe('keep');
  });
});

describe('latePayOf（遅配かもしれない。11/28）', () => {
  it('5月がなく6月が2倍なら知らせる。ふつうの増え方は知らせない', async () => {
    const { latePayOf } = await import('./regular');
    const P = (o: Record<string, number>) => new Map(Object.entries(o).map(([m, cash]) => [m, { cash } as any]));
    const three = ['2026-04', '2026-05', '2026-06'];
    expect(latePayOf(three, P({ '2026-04': 325000, '2026-06': 650000 }))).toEqual({ missing: '2026-05', big: '2026-06' });
    expect(latePayOf(three, P({ '2026-03': 325000, '2026-04': 0, '2026-05': 650000, '2026-06': 325000 }))).toEqual({ missing: '2026-04', big: '2026-05' });
    expect(latePayOf(three, P({ '2026-04': 325000, '2026-06': 400000 }))).toBeNull();
    expect(latePayOf(three, P({ '2026-04': 325000, '2026-05': 325000, '2026-06': 650000 }))).toBeNull();
  });
});
