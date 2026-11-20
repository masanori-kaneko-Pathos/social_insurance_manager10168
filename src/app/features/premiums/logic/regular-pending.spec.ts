import { regularPending, regularYearFor } from './regular-pending';

const person = (id: string, acquired: string, froms: string[]) => ({
  id,
  health: { acquiredDate: acquired },
  pension: { acquiredDate: acquired },
  remunerations: froms.map((from) => ({ from })),
});

describe('regularYearFor（その月に効く定時決定の年）', () => {
  it('9月分〜翌年8月分は、その年の定時決定', () => {
    expect(regularYearFor('2026-09')).toBe(2026);
    expect(regularYearFor('2026-12')).toBe(2026);
    expect(regularYearFor('2027-08')).toBe(2026);
    expect(regularYearFor('2026-08')).toBe(2025);
  });
});

describe('regularPending（定時決定が反映されていない人。11/19）', () => {
  it('9月分の記録がない人を出す。記録がある人・7〜9月の改定がある人は出さない', () => {
    const r = regularPending(
      [
        person('a', '2015-04-01', ['2015-04', '2025-09']),
        person('b', '2015-04-01', ['2015-04', '2025-09', '2026-09']),
        person('c', '2015-04-01', ['2015-04', '2026-08']), // 8月の随時改定
        person('d', '2026-06-01', ['2026-06']), // 6/1 以降の取得は対象外
        person('e', '2026-05-31', ['2026-05']),
      ],
      '2026-10',
      '2026-11-19',
    );
    expect(r).toEqual({ year: 2026, ids: ['a', 'e'] });
  });
  it('7月1日より前は、まだ時期ではないので出さない', () => {
    // 9月分（2026年の定時決定）を、6月30日の時点で先に開いたとき
    expect(regularPending([person('a', '2015-04-01', ['2015-04'])], '2026-09', '2026-06-30')).toBeNull();
    // 6月分は2025年の定時決定（済んでいれば出さない）
    expect(regularPending([person('a', '2015-04-01', ['2015-04', '2025-09'])], '2026-06', '2026-06-30')).toBeNull();
  });
  it('翌年の8月分までは、その年の定時決定を見る', () => {
    expect(regularPending([person('a', '2015-04-01', ['2025-09'])], '2027-08', '2027-08-01')).toEqual({ year: 2026, ids: ['a'] });
    expect(regularPending([person('a', '2015-04-01', ['2026-09'])], '2027-08', '2027-08-01')).toBeNull();
  });
  it('前の年の定時決定の月を開いても知らせない（今の定時決定だけ）', () => {
    expect(regularPending([person('a', '2015-04-01', ['2015-04'])], '2026-08', '2026-11-19')).toBeNull();
    expect(regularPending([person('a', '2015-04-01', ['2015-04'])], '2026-11', '2026-11-19')).toEqual({ year: 2026, ids: ['a'] });
  });
  it('資格を取っていない人（取得日がない）は出さない', () => {
    const p = { id: 'x', health: { acquiredDate: null }, pension: { acquiredDate: null }, remunerations: [] };
    expect(regularPending([p], '2026-10', '2026-11-19')).toBeNull();
  });
});
