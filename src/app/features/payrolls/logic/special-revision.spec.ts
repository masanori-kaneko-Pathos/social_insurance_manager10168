import { GRADES, healthGradeOf, pensionGradeOf } from './grades.fixture';
import { judgeSpecial, specialAfter, SpecialInput } from './special-revision';

// 30万円（健保22級・厚年19級）で働いていた人
const std = (k: number) => ({
  health: { grade: healthGradeOf(k), standard: k * 1000 },
  pension: { grade: pensionGradeOf(k), standard: k * 1000 },
});
const enrolled = (acquiredDate: string, lostDate: string | null = null) => ({ enrolled: true, acquiredDate, lostDate });

// 給与の実績の支払基礎日数（1〜2月はふつうに20日）
const DAYS: Record<string, number> = { '2027-01': 20, '2027-02': 20, '2027-06': 20, '2027-07': 20 };

const input = (over: Partial<SpecialInput> = {}): SpecialInput => ({
  direction: 'down',
  firstMonth: '2027-03',
  amount: 180000, // 療養で短時間勤務になり、18万円に
  days: 18,
  minDaysAt: () => 17,
  daysAt: (m) => DAYS[m] ?? null,
  filedOn: '2027-03-28', // 給与を払った月のうちに届ける
  consent: true,
  ended: false,
  downMonths: [],
  employee: { birthDate: '1990-01-01', health: enrolled('2025-04-01'), pension: enrolled('2025-04-01') },
  remunerations: [{ from: '2026-09', reason: 'regular', monthlyAmount: 300000, ...std(300) }],
  gradesAt: () => GRADES,
  ...over,
});

describe('judgeSpecial（特例改定）', () => {
  it('30万円 → 18万円に下がった：3月に払った分で、4月から改定（健保・厚年とも）', () => {
    const r = judgeSpecial(input());
    expect(r.status).toBe('candidate');
    expect(r.revisedFrom).toBe('2027-04');
    expect(r.health!.after.standard).toBe(180000);
    expect(r.pension!.after.standard).toBe(180000);
    expect(r.health!.revise).toBeTrue();
    expect(r.pension!.revise).toBeTrue();
  });

  it('届出が翌月（4月）にずれたら、3月には遡れない（4月の給与で判断し直す）', () => {
    expect(judgeSpecial(input({ filedOn: '2027-04-10' })).status).toBe('notFiledMonth');
  });

  it('本人の書面の同意がなければ出さない', () => {
    expect(judgeSpecial(input({ consent: false })).status).toBe('noConsent');
  });

  it('前2か月の給与の実績がない・基準に足りない', () => {
    expect(judgeSpecial(input({ daysAt: (m) => (m === '2027-01' ? null : 20) })).status).toBe('priorMissing');
    expect(judgeSpecial(input({ daysAt: (m) => (m === '2027-02' ? 15 : 20) })).status).toBe('priorShortDays');
  });

  it('2027年1月より前の月は対象外', () => {
    expect(judgeSpecial(input({ firstMonth: '2026-12', filedOn: '2026-12-25' })).status).toBe('beforeStart');
  });

  it('まるごと休みで報酬がない月は対象外', () => {
    expect(judgeSpecial(input({ amount: 0 })).status).toBe('noPay');
  });

  it('支払基礎日数が基準に足りない（休んだ日を含めても16日）', () => {
    expect(judgeSpecial(input({ days: 16 })).status).toBe('shortDays');
    expect(judgeSpecial(input({ days: 11, minDaysAt: () => 11 })).status).toBe('candidate'); // 短時間労働者は11日
  });

  it('被保険者の期間が3か月に満たない人は対象外', () => {
    const employee = { birthDate: '1990-01-01', health: enrolled('2027-02-01'), pension: enrolled('2027-02-01') };
    expect(judgeSpecial(input({ employee })).status).toBe('shortInsured');
  });

  it('翌月（改定の月）に資格がない人は対象外', () => {
    const employee = {
      birthDate: '1990-01-01',
      health: enrolled('2025-04-01', '2027-04-01'),
      pension: enrolled('2025-04-01', '2027-04-01'),
    };
    expect(judgeSpecial(input({ employee })).status).toBe('lost');
  });

  it('1等級しか下がらないなら改定しない', () => {
    expect(judgeSpecial(input({ amount: 285000 })).status).toBe('noGradeDiff');
  });

  it('下がったはずが上がっているなら opposite', () => {
    expect(judgeSpecial(input({ amount: 400000 })).status).toBe('opposite');
  });

  it('今の標準報酬がない人', () => {
    expect(judgeSpecial(input({ remunerations: [] })).status).toBe('noStandard');
  });

  describe('戻ったとき（up）', () => {
    const after = [
      { from: '2026-09', reason: 'regular' as const, monthlyAmount: 300000, ...std(300) },
      { from: '2027-04', reason: 'special' as const, monthlyAmount: 180000, ...std(180) },
    ];
    const up = (over: Partial<SpecialInput> = {}) =>
      input({
        direction: 'up',
        firstMonth: '2027-08',
        amount: 300000,
        days: 20,
        filedOn: '2027-09-03', // 戻ったときは届出の月を問わない
        remunerations: after,
        downMonths: ['2027-04'],
        ended: true,
        ...over,
      });

    it('療養が終わり8月に30万円に戻った → 9月から改定', () => {
      const r = judgeSpecial(up());
      expect(r.status).toBe('candidate');
      expect(r.revisedFrom).toBe('2027-09');
      expect(r.health!.after.standard).toBe(300000);
    });

    it('療養等が終わっていないなら出さない', () => {
      expect(judgeSpecial(up({ ended: false })).status).toBe('notEnded');
    });

    it('戻ったときは、同意・前2か月の日数を問わない', () => {
      expect(judgeSpecial(up({ consent: false, daysAt: () => null })).status).toBe('candidate');
    });

    it('前に特例改定（down）をしていない人は対象外', () => {
      expect(judgeSpecial(up({ downMonths: [] })).status).toBe('noDown');
    });
  });

  it('specialAfter：改定する保険だけ新しい等級にする', () => {
    const r = judgeSpecial(input());
    expect(specialAfter(r, std(300))).toEqual(std(180));
    const keep = judgeSpecial(input({ amount: 285000 }));
    expect(specialAfter(keep, std(300))).toEqual(std(300));
  });
});
