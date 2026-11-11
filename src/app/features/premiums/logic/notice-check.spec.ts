import type { OfficeTotal } from '../../../core/models/premium';
import { checkNotice, dueDateOf, noticeArrivalOf } from './notice-check';

const T = (health: number, pension: number, child: number): OfficeTotal[] => [
  { category: 'health', totalYen: health, employeeYen: 0, employerYen: 0 },
  { category: 'pension', totalYen: pension, employeeYen: 0, employerYen: 0 },
  { category: 'childContribution', totalYen: child, employeeYen: 0, employerYen: 0 },
];

describe('dueDateOf：納付期限（日本年金機構の令和8年度下期の表と同じになるか）', () => {
  it('翌月末。末日が土日なら次の営業日', () => {
    expect(dueDateOf('2026-09')).toBe('2026-11-02'); // 10/31 は土曜
    expect(dueDateOf('2026-10')).toBe('2026-11-30');
    expect(dueDateOf('2026-12')).toBe('2027-02-01'); // 1/31 は日曜
    expect(dueDateOf('2027-01')).toBe('2027-03-01'); // 2/28 は日曜
    expect(dueDateOf('2027-02')).toBe('2027-03-31');
  });
  it('年末年始（12/31〜1/3）は休み', () => {
    expect(dueDateOf('2026-11')).toBe('2027-01-04');
  });
  it('告知書は翌月20日ごろ', () => {
    expect(noticeArrivalOf('2026-10')).toBe('2026-11-20');
  });
});

describe('checkNotice：告知額との突き合わせ', () => {
  it('入れていなければ notEntered。全部同じなら match', () => {
    expect(checkNotice(T(100, 200, 3), { health: null, pension: 200, childContribution: 3 }, false).status).toBe('notEntered');
    const c = checkNotice(T(100, 200, 3), { health: 100, pension: 200, childContribution: 3 }, false);
    expect(c.status).toBe('match');
    expect(c.diffTotal).toBe(0);
  });
  it('差は「告知額 − アプリ」。月額だけなら1円でも diff', () => {
    const c = checkNotice(T(100, 200, 3), { health: 101, pension: 200, childContribution: 3 }, false);
    expect(c.status).toBe('diff');
    expect(c.lines[0].diff).toBe(1);
    expect(c.diffTotal).toBe(1);
  });
  it('賞与のある月の1〜2円は端数（rounding）。3円からは diff', () => {
    expect(checkNotice(T(100, 200, 3), { health: 101, pension: 198, childContribution: 3 }, true).status).toBe('rounding');
    expect(checkNotice(T(100, 200, 3), { health: 103, pension: 200, childContribution: 3 }, true).status).toBe('diff');
  });
});
