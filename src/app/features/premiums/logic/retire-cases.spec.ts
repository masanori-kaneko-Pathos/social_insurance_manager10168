/**
 * 入社・退職の月の保険料を、外の正解で確かめる（11/25）
 * 出典 G：日本年金機構「月の途中で入社したときや、退職したときは、厚生年金保険の保険料はどのようになりますか。」
 *   （ページID 150020010-720-780-915、2025年9月1日更新）
 */
import { isChargedMonth } from '../../employees/logic/coverage';
import { isLastMonthBeforeLeaving, isSameMonthPension } from './premium-rows';

const person = (acquiredDate: string, lostDate: string | null) => ({
  birthDate: '1990-05-15',
  health: { enrolled: true, acquiredDate, lostDate, lossReason: 'retire' },
  pension: { enrolled: true, acquiredDate, lostDate, lossReason: 'retire' },
});

describe('出典G 入社・退職の月の保険料', () => {
  it('月の途中（4/15）に入社：資格を取得した4月分から納める', () => {
    expect([isChargedMonth('2026-04-15', null, '2026-03'), isChargedMonth('2026-04-15', null, '2026-04')]).toEqual([false, true]);
  });
  it('月の途中（8/20）に退職：喪失日は翌日の8/21、喪失日の月の前月（7月）分まで', () => {
    expect([isChargedMonth('2024-04-01', '2026-08-21', '2026-07'), isChargedMonth('2024-04-01', '2026-08-21', '2026-08')]).toEqual([true, false]);
  });
  it('月末（8/31）に退職：喪失日は9/1なので、退職した8月分まで納める', () => {
    expect([isChargedMonth('2024-04-01', '2026-09-01', '2026-08'), isChargedMonth('2024-04-01', '2026-09-01', '2026-09')]).toEqual([true, false]);
  });
  it('月末退職は、退職時の給与から前月分と当月分を控除する場合がある → 8月が「最後の月」の案内', () => {
    expect(isLastMonthBeforeLeaving(person('2024-04-01', '2026-09-01'), '2026-08')).toBeTrue();
  });
  it('入社した月に退職（9/1 入社・9/20 退職）：その月の厚生年金保険料はかかる（同月得喪）', () => {
    expect(isChargedMonth('2026-09-01', '2026-09-21', '2026-09')).toBeTrue();
    expect(isSameMonthPension(person('2026-09-01', '2026-09-21'), '2026-09')).toBeTrue();
  });
});
