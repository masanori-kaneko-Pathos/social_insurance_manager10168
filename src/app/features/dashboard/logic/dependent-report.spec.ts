import { dependentReportTodos } from './extra-todos';

const person = (acquired: string | null, lost: string | null = null, enrolled = true) => ({
  id: 'e1',
  health: { enrolled, acquiredDate: acquired, lostDate: lost },
});

describe('dependentReportTodos（被扶養者（異動）届）', () => {
  const today = '2026-11-20';

  it('入社と同じ日に扶養に入った家族：取得届と一緒に出す1件（人数つき）', () => {
    const out = dependentReportTodos(person('2026-11-16'), [
      { from: '2026-11-16', to: null },
      { from: '2026-11-16', to: null },
    ], today);
    expect(out.length).toBe(1);
    expect(out[0].kind).toBe('dependentReport');
    expect(out[0].date).toBe('2026-11-16');
    expect(out[0].params).toEqual({ date: '2026-11-16', start: 2, end: 0 });
  });

  it('子が生まれた日と、配偶者が外れた日は別々の件', () => {
    const out = dependentReportTodos(person('2015-04-01'), [
      { from: '2026-11-12', to: null },
      { from: '2015-04-01', to: '2026-10-01' },
    ], today);
    expect(out.map((t) => [t.date, t.params['start'], t.params['end']])).toEqual([
      ['2026-10-01', 0, 1],
      ['2026-11-12', 1, 0],
    ]);
  });

  it('60日より前・今日より後の日は出さない', () => {
    const out = dependentReportTodos(person('2015-04-01'), [
      { from: '2026-09-20', to: null },
      { from: '2026-11-21', to: null },
      { from: '2026-09-21', to: null },
    ], today);
    expect(out.map((t) => t.date)).toEqual(['2026-09-21']);
  });

  it('健康保険に入っていない人・取得前・喪失後の日は出さない', () => {
    const deps = [{ from: '2026-11-10', to: null }];
    expect(dependentReportTodos(person('2026-11-10', null, false), deps, today)).toEqual([]);
    expect(dependentReportTodos(person('2026-11-11'), deps, today)).toEqual([]);
    expect(dependentReportTodos(person('2015-04-01', '2026-11-10'), deps, today)).toEqual([]);
  });

  it('マイページの申請から来た届出の宿題が残っている人は出さない', () => {
    const out = dependentReportTodos(person('2015-04-01'), [{ from: '2026-11-12', to: null }], today, new Set(['e1']));
    expect(out).toEqual([]);
  });
});
