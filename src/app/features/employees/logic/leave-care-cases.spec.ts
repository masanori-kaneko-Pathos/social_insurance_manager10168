/**
 * 保険料の免除・介護保険の月を、外の正解で確かめる（11/25）
 *
 * 出典 D：日本年金機構「令和4年10月から育児休業等期間中における社会保険料の免除要件が改正されます」（事業主向けリーフレット）
 *   ① 月額：開始月は、月末が育休中か、同じ月の中で14日以上取ったら免除 ② 賞与：1か月超（暦日）取ったときだけ免除
 *   改正後の届出様式の記入例：同じ月に2回（10/3〜10/12 の就業予定2日、10/17〜10/28）→ 取得日数 8 ＋ 12 ＝ 20日
 * 出典 E：全国健康保険協会「介護保険料はいつから徴収されますか？／いつから徴収されなくなりますか？」
 *   40歳（65歳）の誕生日の前日が属する月から。5月2日生まれ → 5月分、5月1日生まれ → 4月分
 */
import type { LeaveLike } from './leave';
import { exemptBonus, exemptMonth, sameMonthDays } from './leave';
import { isCareMonth } from './coverage';

const ikukyu = (start: string, end: string, workDays: number | null = null): LeaveLike => ({
  kind: 'childcare',
  start,
  end,
  plannedEnd: null,
  workDays,
  filed: { filedOn: null },
});

describe('出典D ① 月額保険料（改正後。N月 ＝ 2026年6月）', () => {
  it('月末をまたぐ3日の育休（6/29〜7/1）→ 6月は免除、7月は免除されない', () => {
    const l = [ikukyu('2026-06-29', '2026-07-01')];
    expect([exemptMonth(l, '2026-06'), exemptMonth(l, '2026-07')]).toEqual([true, false]);
  });
  it('月の中で14日の育休（6/5〜6/18）→ 6月は免除（改正前は免除されなかった）', () => {
    const l = [ikukyu('2026-06-05', '2026-06-18')];
    expect([exemptMonth(l, '2026-06'), exemptMonth(l, '2026-07')]).toEqual([true, false]);
  });
  it('月の中で13日なら免除されない', () => {
    expect(exemptMonth([ikukyu('2026-06-05', '2026-06-17')], '2026-06')).toBeFalse();
  });
});

describe('出典D ② 賞与保険料（改正後）', () => {
  it('月末をまたぐ3日の育休 → 6月に払った賞与は免除されない', () => {
    expect(exemptBonus([ikukyu('2026-06-29', '2026-07-01')], '2026-06-25')).toBeFalse();
  });
  it('N月10日〜N+1月24日の育休（1か月超）→ N月に払った賞与は免除', () => {
    expect(exemptBonus([ikukyu('2026-06-10', '2026-07-24')], '2026-06-25')).toBeTrue();
  });
});

describe('出典D 届出様式の記入例：同じ月に2回の育休（令和4年10月）', () => {
  // 1回目は出生時育休で就業予定日数2日（10日 − 2日 ＝ 8日）、2回目は12日
  const l: LeaveLike[] = [
    { ...ikukyu('2022-10-03', '2022-10-12', 2), kind: 'paternity' },
    ikukyu('2022-10-17', '2022-10-28'),
  ];
  it('取得日数は 8 ＋ 12 ＝ 20日 → 14日以上なので10月は免除', () => {
    expect(sameMonthDays(l, '2022-10')).toBe(20);
    expect(exemptMonth(l, '2022-10')).toBeTrue();
  });
});

describe('出典E 介護保険（第2号被保険者）の月', () => {
  it('5月2日生まれ：40歳の5月分から徴収（4月分はなし）', () => {
    const e = { birthDate: '1986-05-02', careExemptions: [] };
    expect([isCareMonth(e, '2026-04'), isCareMonth(e, '2026-05')]).toEqual([false, true]);
  });
  it('5月1日生まれ：誕生日の前日が4月30日なので、40歳の4月分から徴収', () => {
    const e = { birthDate: '1986-05-01', careExemptions: [] };
    expect([isCareMonth(e, '2026-03'), isCareMonth(e, '2026-04')]).toEqual([false, true]);
  });
  it('5月2日生まれ：65歳の5月分から徴収しない（4月分までは徴収）', () => {
    const e = { birthDate: '1961-05-02', careExemptions: [] };
    expect([isCareMonth(e, '2026-04'), isCareMonth(e, '2026-05')]).toEqual([true, false]);
  });
  it('5月1日生まれ：65歳の4月分から徴収しない（3月分までは徴収）', () => {
    const e = { birthDate: '1961-05-01', careExemptions: [] };
    expect([isCareMonth(e, '2026-03'), isCareMonth(e, '2026-04')]).toEqual([true, false]);
  });
});
