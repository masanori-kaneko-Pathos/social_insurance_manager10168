import { exemptBonus, exemptMonth, exemptRangeOf, leaveExemptsMonth, LeaveLike, oneMonthEnd } from './leave';
import { daysInclusive } from '../../../shared/utils/date';

const maternity = (start: string, end: string | null): LeaveLike => ({
  kind: 'maternity',
  start,
  end,
});
const childcare = (start: string, end: string | null): LeaveLike => ({
  kind: 'childcare',
  start,
  end,
});

describe('日付の小道具', () => {
  it('daysInclusive：両端を含む', () => {
    expect(daysInclusive('2026-11-01', '2026-11-14')).toBe(14);
  });

  it('oneMonthEnd：翌月の応当日の前日、応当日がなければ翌月末', () => {
    expect(oneMonthEnd('2026-01-15')).toBe('2026-02-14');
    expect(oneMonthEnd('2027-01-31')).toBe('2027-02-28');
    expect(oneMonthEnd('2026-12-20')).toBe('2027-01-19'); // 年をまたぐ
  });
});

describe('exemptMonth：月額の免除', () => {
  it('開始月 〜 終了日の翌日の月の前月', () => {
    const l = [maternity('2026-10-20', '2027-01-14')]; // 翌日 1/15 → 12月まで
    expect(exemptMonth(l, '2026-09')).toBeFalse();
    expect(exemptMonth(l, '2026-10')).toBeTrue();
    expect(exemptMonth(l, '2026-12')).toBeTrue();
    expect(exemptMonth(l, '2027-01')).toBeFalse();
  });

  it('月末に終わると、その月まで免除（翌日が翌月1日）', () => {
    const l = [childcare('2026-11-01', '2027-03-31')];
    expect(exemptMonth(l, '2027-03')).toBeTrue();
    expect(exemptMonth(l, '2027-04')).toBeFalse();
  });

  it('月の中で終わる育休：14日以上なら免除、13日なら免除なし', () => {
    expect(exemptMonth([childcare('2026-11-01', '2026-11-14')], '2026-11')).toBeTrue();
    expect(exemptMonth([childcare('2026-11-01', '2026-11-13')], '2026-11')).toBeFalse();
  });

  it('14日ルールは産休と、2022年10月より前に始まった育休には使わない', () => {
    expect(exemptMonth([maternity('2026-11-01', '2026-11-20')], '2026-11')).toBeFalse();
    expect(exemptMonth([childcare('2022-09-01', '2022-09-20')], '2022-09')).toBeFalse();
  });

  it('終了が未定なら、開始月から先はずっと免除', () => {
    expect(exemptMonth([childcare('2026-11-10', null)], '2027-10')).toBeTrue();
  });

  it('休業がなければ免除なし', () => {
    expect(exemptMonth(undefined, '2026-11')).toBeFalse();
  });
});

describe('exemptBonus：賞与の免除', () => {
  it('育休：1か月ちょうどは免除なし、1か月を超えれば免除', () => {
    expect(exemptBonus([childcare('2026-11-10', '2026-12-09')], '2026-11-30')).toBeFalse();
    expect(exemptBonus([childcare('2026-11-10', '2026-12-10')], '2026-11-30')).toBeTrue();
  });

  it('育休：14日ルールだけで免除になる月の賞与は免除なし', () => {
    expect(exemptBonus([childcare('2026-11-01', '2026-11-20')], '2026-11-25')).toBeFalse();
  });

  it('産休：免除の月に払った賞与は免除', () => {
    expect(exemptBonus([maternity('2026-10-20', '2027-01-14')], '2026-12-10')).toBeTrue();
    expect(exemptBonus([maternity('2026-10-20', '2027-01-14')], '2027-01-10')).toBeFalse();
  });

  it('終了未定の育休は「1か月を超える」とみなす', () => {
    expect(exemptBonus([childcare('2026-11-10', null)], '2026-12-10')).toBeTrue();
  });
});

describe('exemptRangeOf：画面に出す免除の月', () => {
  it('ふつうの休業', () => {
    expect(exemptRangeOf(maternity('2026-10-20', '2027-01-14'))).toEqual({
      from: '2026-10',
      to: '2026-12',
    });
  });

  it('月の中で終わる14日以上の育休はその月だけ、13日なら免除なし', () => {
    expect(exemptRangeOf(childcare('2026-11-01', '2026-11-14'))).toEqual({
      from: '2026-11',
      to: '2026-11',
    });
    expect(exemptRangeOf(childcare('2026-11-01', '2026-11-13'))).toBeNull();
  });

  it('未定は to が null', () => {
    expect(exemptRangeOf(childcare('2026-11-10', null))).toEqual({ from: '2026-11', to: null });
  });
});

describe('休業の種類（11/6 追加）', () => {
  it('出生時育休も育休と同じ：月の中で14日以上なら免除', () => {
    const l = { kind: 'paternity' as const, start: '2026-11-01', end: '2026-11-14' };
    expect(leaveExemptsMonth(l, '2026-11')).toBeTrue();
  });
  it('出生時育休：休業中に働いた日は14日から除く（14日 − 1日 ＝ 13日なので免除なし）', () => {
    const l = { kind: 'paternity' as const, start: '2026-11-01', end: '2026-11-14', workDays: 1 };
    expect(leaveExemptsMonth(l, '2026-11')).toBeFalse();
  });
  it('介護休業・休職は免除なし', () => {
    expect(exemptMonth([{ kind: 'care', start: '2026-10-01', end: '2026-12-31' }], '2026-11')).toBeFalse();
    expect(exemptMonth([{ kind: 'suspension', start: '2026-10-01', end: null }], '2026-11')).toBeFalse();
  });
  it('介護休業中の賞与も免除なし', () => {
    expect(exemptBonus([{ kind: 'care', start: '2026-06-01', end: '2026-08-31' }], '2026-07-10')).toBeFalse();
  });
});
