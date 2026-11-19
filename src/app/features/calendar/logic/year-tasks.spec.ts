import { monthlyTasks, upcomingMonths, yearTasks } from './year-tasks';

const keys = (o: Parameters<typeof yearTasks>[0], m: number) => yearTasks(o).find((x) => x.month === m)!.tasks.map((t) => t.key);

describe('yearTasks：1年の業務の暦', () => {
  const base = { bonusMonths: [6, 12], insurer: 'kyokai' as const, deduction: 'next' as const };

  it('7月は算定基礎届、9月は新しい標準報酬（翌月徴収なら10月の給与から）', () => {
    expect(keys(base, 7)).toContain('regular');
    const sep = yearTasks(base)[8].tasks.find((t) => t.key === 'regularApply')!;
    expect(sep.params).toEqual({ payMonth: 10 });
    const cur = yearTasks({ ...base, deduction: 'current' })[8].tasks.find((t) => t.key === 'regularApply')!;
    expect(cur.params).toEqual({ payMonth: 9 });
  });

  it('賞与の月に賞与支払届。並びは月の順で、重複はまとめる', () => {
    expect(keys(base, 6)).toContain('bonus');
    expect(keys(base, 12)).toContain('bonus');
    expect(keys({ ...base, bonusMonths: [12, 12] }, 12).filter((k) => k === 'bonus').length).toBe(1);
    expect(keys(base, 7)).not.toContain('bonus');
  });

  it('協会けんぽ：3月に料率、10月にリスト、12月に期限。健保組合は時期が違う', () => {
    expect(keys(base, 3)).toContain('ratesKyokai');
    expect(keys(base, 10)).toContain('dependentList');
    expect(keys(base, 12)).toContain('dependentDue');
    const k = { ...base, insurer: 'kumiai' as const };
    expect(keys(k, 3)).toContain('ratesKumiai');
    expect(keys(k, 10)).toContain('dependentKumiai');
    expect(keys(k, 12)).not.toContain('dependentDue');
  });

  it('アプリの対象外の業務は outside で、移る画面はない', () => {
    const t = yearTasks(base)[11].tasks.find((x) => x.key === 'yearEnd')!;
    expect(t.outside).toBeTrue();
    expect(t.link).toBeNull();
  });

  it('毎月の業務と、今月から12か月', () => {
    expect(monthlyTasks().map((t) => t.key)).toEqual(['payroll', 'payment', 'joinLeave', 'watchRevision']);
    const m = upcomingMonths('2026-11');
    expect(m[0]).toBe('2026-11');
    expect(m[11]).toBe('2027-10');
  });
});
