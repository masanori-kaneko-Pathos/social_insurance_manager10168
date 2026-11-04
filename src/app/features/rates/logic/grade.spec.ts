import { GradeTableDoc } from '../../../core/models/rates';
import { decideStandard, formatYen, gradeOf, parseYen, pickGradeTable } from './grade';

// テスト用の等級表（本物の表の、下限・上限付近だけ）
const HEALTH: GradeTableDoc = {
  kind: 'health',
  from: '2024-03',
  source: 'test',
  grades: [
    { grade: 1, standard: 58000, min: 0 },
    { grade: 2, standard: 68000, min: 63000 },
    { grade: 3, standard: 78000, min: 73000 },
    { grade: 4, standard: 88000, min: 83000 },
    { grade: 5, standard: 98000, min: 93000 },
    { grade: 49, standard: 1330000, min: 1295000 },
    { grade: 50, standard: 1390000, min: 1355000 },
  ],
};

const PENSION: GradeTableDoc = {
  kind: 'pension',
  from: '2024-03',
  source: 'test',
  grades: [
    { grade: 1, standard: 88000, min: 0 },
    { grade: 2, standard: 98000, min: 93000 },
    { grade: 31, standard: 620000, min: 605000 },
    { grade: 32, standard: 650000, min: 635000 },
  ],
};

// 2027年9月から厚年の上限が上がる（33等級 68万円）想定の表
const PENSION_2027: GradeTableDoc = {
  ...PENSION,
  from: '2027-09',
  grades: [
    ...PENSION.grades.slice(0, 3),
    { grade: 32, standard: 650000, min: 635000 },
    { grade: 33, standard: 680000, min: 665000 },
  ],
};

describe('gradeOf：報酬月額 → 等級', () => {
  it('境目ちょうどは上の等級、1円手前は下の等級', () => {
    expect(gradeOf(HEALTH.grades, 62999)).toEqual({ grade: 1, standard: 58000 });
    expect(gradeOf(HEALTH.grades, 63000)).toEqual({ grade: 2, standard: 68000 });
  });

  it('健保の下限（0円）と上限（1,355,000円以上は50級）', () => {
    expect(gradeOf(HEALTH.grades, 0).grade).toBe(1);
    expect(gradeOf(HEALTH.grades, 1354999).grade).toBe(49);
    expect(gradeOf(HEALTH.grades, 1355000).grade).toBe(50);
    expect(gradeOf(HEALTH.grades, 5000000).grade).toBe(50);
  });

  it('厚年は 93,000円未満が1級、635,000円以上が32級', () => {
    expect(gradeOf(PENSION.grades, 92999)).toEqual({ grade: 1, standard: 88000 });
    expect(gradeOf(PENSION.grades, 93000)).toEqual({ grade: 2, standard: 98000 });
    expect(gradeOf(PENSION.grades, 634999).grade).toBe(31);
    expect(gradeOf(PENSION.grades, 635000)).toEqual({ grade: 32, standard: 650000 });
    expect(gradeOf(PENSION.grades, 1000000).grade).toBe(32);
  });

  it('同じ報酬月額でも、健保と厚年で等級が違う', () => {
    expect(gradeOf(HEALTH.grades, 95000).grade).toBe(5);
    expect(gradeOf(PENSION.grades, 95000).grade).toBe(2);
  });

  it('負の数・小数はエラーで止まる', () => {
    expect(() => gradeOf(HEALTH.grades, -1)).toThrowError(/報酬月額/);
    expect(() => gradeOf(HEALTH.grades, 300000.5)).toThrowError(/報酬月額/);
  });
});

describe('decideStandard：その月の等級表で決める', () => {
  const tables = [HEALTH, PENSION, PENSION_2027];

  it('上限が上がる前の月は、厚年は32級で頭打ち', () => {
    const d = decideStandard(tables, '2027-08', 700000);
    expect(d.pension).toEqual({ grade: 32, standard: 650000 });
  });

  it('上限が上がった月からは、新しい33級', () => {
    const d = decideStandard(tables, '2027-09', 700000);
    expect(d.pension).toEqual({ grade: 33, standard: 680000 });
    // 健保の等級表は変わらないので、2024年3月分からの表のまま
    expect(pickGradeTable(tables, 'health', '2027-09')?.from).toBe('2024-03');
  });

  it('等級表がない月（データの始まりより前）は null', () => {
    const d = decideStandard(tables, '2024-02', 300000);
    expect(d.health).toBeNull();
    expect(d.pension).toBeNull();
  });
});

describe('parseYen / formatYen', () => {
  it('カンマ・全角・空白を受け付ける', () => {
    expect(parseYen('300000')).toBe(300000);
    expect(parseYen('300,000')).toBe(300000);
    expect(parseYen('３００，０００')).toBe(300000);
    expect(parseYen(' 0 ')).toBe(0);
  });

  it('読めないもの・小数・1億円以上は null', () => {
    expect(parseYen('')).toBeNull();
    expect(parseYen('abc')).toBeNull();
    expect(parseYen('-1')).toBeNull();
    expect(parseYen('300000.5')).toBeNull();
    expect(parseYen('100000000')).toBeNull();
  });

  it('3桁ごとにカンマ', () => {
    expect(formatYen(1390000)).toBe('1,390,000');
  });
});