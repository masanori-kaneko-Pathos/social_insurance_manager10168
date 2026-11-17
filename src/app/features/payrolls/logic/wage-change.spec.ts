import { directionOfKind, toWageChange, wageChangeErrors } from './wage-change';
import { findStartMonths } from './irregular';

const ctx = { fromMonth: '2024-11', thisMonth: '2026-11' };
const ok = { employeeId: 'e1', month: '2026-05', kind: 'unitPrice' as const, direction: 'up' as const, note: '' };

describe('wageChangeErrors：人が足す固定的賃金の変動（B11）', () => {
  it('そろっていればエラーなし', () => {
    expect(wageChangeErrors(ok, ctx)).toEqual({});
  });
  it('人・月・種類・向きがない。出し始めより前・来月以降の月。メモが長い', () => {
    expect(wageChangeErrors({ employeeId: '', month: '2026/5', kind: '', direction: '', note: 'x'.repeat(201) }, ctx)).toEqual({
      employeeId: 'employee', month: 'month', kind: 'kind', direction: 'direction', note: 'note',
    });
    expect(wageChangeErrors({ ...ok, month: '2024-10' }, ctx).month).toBe('tooOld');
    expect(wageChangeErrors({ ...ok, month: '2026-12' }, ctx).month).toBe('future');
  });
});

describe('toWageChange・directionOfKind', () => {
  it('メモの空は null', () => {
    expect(toWageChange({ ...ok, note: '  ' }, 'manual')).toEqual({ month: '2026-05', source: 'manual', kind: 'unitPrice', direction: 'up', note: null });
  });
  it('種類から向きの初期値', () => {
    expect(directionOfKind('raise')).toBe('up');
    expect(directionOfKind('allowanceEnd')).toBe('down');
    expect(directionOfKind('contractHours')).toBe('');
  });
});

describe('findStartMonths に足す・外す（つながりの確かめ）', () => {
  const p = (m: string, fixed: number) => [m, { paidMonth: m, fixed, retro: 0 }] as const;
  const payrolls = new Map([p('2026-04', 15600), p('2026-05', 15600), p('2026-06', 20000), p('2026-07', 20000)]) as any;
  it('時給の人：時給が上がった月を足すと起算月になる。自動で見つかった月は外せる', () => {
    const found = findStartMonths(payrolls, [toWageChange({ ...ok, month: '2026-05' }, 'manual')]);
    expect(found.map((s) => [s.month, s.source])).toEqual([['2026-05', 'manual'], ['2026-06', 'fixed']]);
    const dismissed = findStartMonths(payrolls, [toWageChange({ ...ok, month: '2026-06', kind: 'other', direction: 'unclear' }, 'dismissed')]);
    expect(dismissed).toEqual([]);
  });
});
