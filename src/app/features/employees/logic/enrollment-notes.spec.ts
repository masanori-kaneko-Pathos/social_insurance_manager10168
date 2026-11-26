import { enrollmentNotes } from './enrollment-notes';

describe('enrollmentNotes', () => {
  const e = (acquiredDate: string, lostDate = '', enrolled = true) => ({ enrolled, acquiredDate, lostDate });

  it('取得日が入社日、喪失日が退職日の翌日なら何も出さない', () => {
    expect(enrollmentNotes('2026-04-01', '2026-10-31', e('2026-04-01', '2026-11-01'))).toEqual([]);
  });

  it('取得日が入社日と違うと知らせる（途中から加入の条件を満たした人も、知らせるだけ）', () => {
    expect(enrollmentNotes('2026-04-01', '', e('2026-07-01'))).toEqual(['acquiredNotHire']);
  });

  it('加入していないなら取得日は比べない', () => {
    expect(enrollmentNotes('2026-04-01', '', e('2026-07-01', '', false))).toEqual([]);
  });

  it('喪失日が退職日の翌日と違うと知らせる（月末退職の翌月1日を、月末と取り違えた例）', () => {
    expect(enrollmentNotes('2026-04-01', '2026-10-31', e('2026-04-01', '2026-10-31'))).toEqual(['lostNotRetireNext']);
  });

  it('退職日がないとき（年齢で抜けた）は喪失日を比べない', () => {
    expect(enrollmentNotes('2020-04-01', '', e('2020-04-01', '2026-08-01'))).toEqual([]);
  });

  it('空欄は比べない', () => {
    expect(enrollmentNotes('', '', e(''))).toEqual([]);
  });
});
