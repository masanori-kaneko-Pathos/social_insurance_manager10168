import { procedureRows } from './procedures';

describe('procedureRows（従業員の手続き。11/28）', () => {
  const F = (id: string, o: any) => ({ id, type: 'acquisition', employeeIds: ['e'], subject: null, submittedOn: null, note: null, ...o }) as any;
  const T = (id: string, o: any) => ({ id, kind: 'address', employeeId: 'e', factDate: '2026-05-01', fields: [], status: 'open', ...o }) as any;
  it('未完了を先に、発生日の新しい順。完了は提出した日つき', () => {
    const rows = procedureRows(
      [F('a', { subject: '2026-04-01', submittedOn: '2026-04-03' }), F('b', { type: 'loss', subject: '2026-10-01' }), F('c', { employeeIds: ['x'] }), F('d', { type: 'regular', subject: '2026', submittedOn: '2026-07-05' })],
      [T('t1', {}), T('t2', { status: 'done', factDate: '2026-09-01' }), T('t3', { employeeId: null })],
      'e',
      () => '2026-09-03',
    );
    expect(rows.map((r) => [r.key, r.date, r.done, r.doneOn])).toEqual([
      ['filing:b', '2026-10-01', false, null],
      ['task:t1', '2026-05-01', false, null],
      ['task:t2', '2026-09-01', true, '2026-09-03'],
      ['filing:a', '2026-04-01', true, '2026-04-03'],
      ['filing:d', null, true, '2026-07-05'],
    ]);
    expect(rows[0].label).toBe('employee.procedures.type.loss');
    expect(rows[1].label).toBe('dashboard.todo.kind.address');
  });
});
