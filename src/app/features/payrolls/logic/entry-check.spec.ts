import { aboveContract, belowContract, entryCheck, EntryCheckInput, startsHere } from './entry-check';

const base = (x: Partial<EntryCheckInput> = {}): EntryCheckInput => ({
  byUnit: false,
  fixedNow: 300000,
  hasLines: true,
  fixedPrev: 300000,
  inKindNow: null,
  inKindPrev: null,
  retro: 0,
  prorated: false,
  contractChange: null,
  days: 31,
  minDays: 17,
  ...x,
});

describe('entryCheck：この入力で決まること（11/26）', () => {
  it('まだ入力がなければ empty（日数の注意も出さない）', () => {
    expect(entryCheck(base({ fixedNow: null, days: 5 }))).toEqual({ kind: 'empty', shortDays: false });
  });

  it('月給の人：固定的賃金が上がった・下がった・同じ', () => {
    expect(entryCheck(base({ fixedNow: 320000 })).kind).toBe('up');
    expect(entryCheck(base({ fixedNow: 280000 })).kind).toBe('down');
    expect(entryCheck(base()).kind).toBe('same');
  });

  it('前の月の入力がない・0円なら比べない', () => {
    expect(entryCheck(base({ fixedPrev: null })).kind).toBe('noPrev');
    expect(entryCheck(base({ fixedPrev: 0 })).kind).toBe('noPrev');
  });

  it('時給・日給の人で内訳がない月は、額では比べない（働いた時間の増減は変動ではない。事例集 問1-3）', () => {
    expect(entryCheck(base({ byUnit: true, hasLines: false, fixedNow: 192000, fixedPrev: 180000 })).kind).toBe('byContract');
  });

  it('時給・日給の人でも、内訳があれば時給×時間を除いた額（手当）の変化は見る', () => {
    expect(entryCheck(base({ byUnit: true, hasLines: true, fixedNow: 15000, fixedPrev: 10000 })).kind).toBe('up');
    expect(entryCheck(base({ byUnit: true, hasLines: true, fixedNow: 10000, fixedPrev: 10000 })).kind).toBe('same');
  });

  it('雇用契約の変更の起算月がいちばん先（時給・時間が変わった月）', () => {
    expect(entryCheck(base({ byUnit: true, hasLines: false, contractChange: 'up' })).kind).toBe('contract');
    expect(entryCheck(base({ contractChange: 'down', fixedNow: 320000 })).kind).toBe('contract');
  });

  it('日割りの月に変わったら、次の月から数える（事例7）', () => {
    expect(entryCheck(base({ fixedNow: 310000, prorated: true })).kind).toBe('prorated');
    expect(entryCheck(base({ inKindNow: 8000, inKindPrev: 0, prorated: true })).kind).toBe('prorated');
  });

  it('現物給与の額が変わった・遡及支払額がある', () => {
    expect(entryCheck(base({ inKindNow: 20800, inKindPrev: 0 })).kind).toBe('inKind');
    expect(entryCheck(base({ retro: 5000 })).kind).toBe('retro');
  });

  it('現物が分からない（総支給額に含まれている）月とは比べない', () => {
    expect(entryCheck(base({ inKindNow: null, inKindPrev: 20800 })).kind).toBe('same');
  });

  it('支払基礎日数が基準に届かない月（17日。短時間労働者は11日）', () => {
    expect(entryCheck(base({ days: 16 })).shortDays).toBeTrue();
    expect(entryCheck(base({ days: 17 })).shortDays).toBeFalse();
    expect(entryCheck(base({ days: 12, minDays: 11 })).shortDays).toBeFalse();
    expect(entryCheck(base({ days: null })).shortDays).toBeFalse();
  });

  it('起算月になる種類', () => {
    expect(['contract', 'up', 'down', 'inKind', 'retro'].every((k) => startsHere(k as never))).toBeTrue();
    expect(['empty', 'prorated', 'byContract', 'noPrev', 'same'].some((k) => startsHere(k as never))).toBeFalse();
  });
});

describe('belowContract（固定的賃金と契約の所定内賃金）', () => {
  it('所定内賃金より少ないと、その所定内賃金を返す', () => {
    expect(belowContract({ fixedBeforeDeduction: 280000, scheduledWage: 300000, prorated: false })).toBe(300000);
  });
  it('同じか多い（通勤手当・家族手当を含むので多いのがふつう）なら null', () => {
    expect(belowContract({ fixedBeforeDeduction: 300000, scheduledWage: 300000, prorated: false })).toBeNull();
    expect(belowContract({ fixedBeforeDeduction: 315000, scheduledWage: 300000, prorated: false })).toBeNull();
  });
  it('日割りの月・欠勤控除の前の額が分からない月・契約がない（時給の人を含む）ときは比べない', () => {
    expect(belowContract({ fixedBeforeDeduction: 150000, scheduledWage: 300000, prorated: true })).toBeNull();
    expect(belowContract({ fixedBeforeDeduction: null, scheduledWage: 300000, prorated: false })).toBeNull();
    expect(belowContract({ fixedBeforeDeduction: 150000, scheduledWage: null, prorated: false })).toBeNull();
    expect(belowContract({ fixedBeforeDeduction: 150000, scheduledWage: undefined, prorated: false })).toBeNull();
  });
});

describe('aboveContract（固定的賃金が契約の所定内賃金より2割を超えて多い。11/28）', () => {
  it('2割を超えたら比べた所定内賃金を返す', () => {
    expect(aboveContract({ fixedBeforeDeduction: 360001, scheduledWage: 300000, prorated: false })).toBe(300000);
    expect(aboveContract({ fixedBeforeDeduction: 360000, scheduledWage: 300000, prorated: false })).toBeNull(); // ちょうど2割は知らせない
    expect(aboveContract({ fixedBeforeDeduction: 320000, scheduledWage: 300000, prorated: false })).toBeNull(); // 通勤手当くらいの差
  });
  it('日割りの月・契約がない・額がないときは比べない', () => {
    expect(aboveContract({ fixedBeforeDeduction: 500000, scheduledWage: 300000, prorated: true })).toBeNull();
    expect(aboveContract({ fixedBeforeDeduction: 500000, scheduledWage: null, prorated: false })).toBeNull();
    expect(aboveContract({ fixedBeforeDeduction: null, scheduledWage: 300000, prorated: false })).toBeNull();
  });
});
