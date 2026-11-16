import { GradeTableDoc } from '../../../core/models/rates';
import { capRevisionsOf, withCapRevisions } from './cap-revision';

// 本物の表の上の方だけ
const HEALTH: GradeTableDoc = {
  kind: 'health',
  from: '2024-03',
  source: 'test',
  grades: [
    { grade: 1, standard: 58000, min: 0 },
    { grade: 49, standard: 1330000, min: 1295000 },
    { grade: 50, standard: 1390000, min: 1355000 },
  ],
};
const P32 = [
  { grade: 1, standard: 88000, min: 0 },
  { grade: 31, standard: 620000, min: 605000 },
  { grade: 32, standard: 650000, min: 635000 },
];
const P33 = [...P32, { grade: 33, standard: 680000, min: 665000 }];
const P34 = [...P33, { grade: 34, standard: 710000, min: 695000 }];
const TABLES: GradeTableDoc[] = [
  HEALTH,
  { kind: 'pension', from: '2024-03', source: 'test', grades: P32 },
  { kind: 'pension', from: '2027-09', source: 'test', grades: P33 },
  { kind: 'pension', from: '2028-09', source: 'test', grades: P34 },
];

const rem = (from: string, monthlyAmount: number, pensionGrade: number) => ({
  from,
  reason: 'acquisition' as const,
  monthlyAmount,
  health: { grade: 40, standard: 830000 },
  pension: { grade: pensionGrade, standard: P34.find((g) => g.grade === pensionGrade)!.standard },
});

describe('withCapRevisions（等級の上限が上がったときの一斉改定）', () => {
  it('32級で報酬月額67万円 → 2027-09 から33級 68万円（健保はそのまま）', () => {
    const out = withCapRevisions([rem('2025-09', 670000, 32)], TABLES);
    expect(out.length).toBe(2);
    const added = out[1];
    expect(added.from).toBe('2027-09');
    expect(added.pension).toEqual({ grade: 33, standard: 680000 });
    expect(added.health).toEqual({ grade: 40, standard: 830000 });
    expect(added.capRevised).toEqual(['pension']);
    expect(added.monthlyAmount).toBe(670000);
  });

  it('32級でも報酬月額64万円（33級の下限66.5万円未満）なら改定しない', () => {
    expect(withCapRevisions([rem('2025-09', 640000, 32)], TABLES).length).toBe(1);
  });

  it('一番上でない人（31級）は改定しない', () => {
    expect(withCapRevisions([rem('2025-09', 620000, 31)], TABLES).length).toBe(1);
  });

  it('2027-09 から決まった行（定時決定）がある人は、新しい表で決まっているので何もしない', () => {
    const out = withCapRevisions([rem('2025-09', 670000, 32), rem('2027-09', 670000, 33)], TABLES);
    expect(out.length).toBe(2);
    expect(out.every((r) => !('capRevised' in r))).toBeTrue();
  });

  it('報酬月額70万円 → 2027-09 に33級、2028-09 に34級（続けて改定）', () => {
    const list = capRevisionsOf([rem('2025-09', 700000, 32)], TABLES);
    expect(list.map((r) => [r.from, r.pension.grade])).toEqual([
      ['2027-09', 33],
      ['2028-09', 34],
    ]);
  });

  it('報酬月額68万円 → 2027-09 に33級。34級の下限（69.5万円）に届かないので 2028-09 はそのまま', () => {
    const list = capRevisionsOf([rem('2025-09', 680000, 32)], TABLES);
    expect(list.map((r) => r.from)).toEqual(['2027-09']);
  });

  it('改定のあとに随時改定の行があれば、そちらが優先（足した行はその前の月まで）', () => {
    const out = withCapRevisions([rem('2025-09', 670000, 32), rem('2028-01', 400000, 31)], TABLES);
    expect(out.map((r) => r.from).sort()).toEqual(['2025-09', '2027-09', '2028-01']);
  });

  it('報酬の履歴がなければ空のまま。元の配列は変えない', () => {
    expect(withCapRevisions([], TABLES)).toEqual([]);
    const src = [rem('2025-09', 670000, 32)];
    withCapRevisions(src, TABLES);
    expect(src.length).toBe(1);
  });
});
