import {
  coverageErrors,
  CoverageFormValue,
  coverageWarnings,
  emptyCoverageForm,
  fromCoverageForm,
  normalizeMonths,
  toCoverageForm,
  toggleMonth,
} from './office-form-model';

/** よくある事業所：週40時間・月21日、特定適用事業所ではない */
function usual(): CoverageFormValue {
  return { ...emptyCoverageForm(), hours: '40:00', monthlyDays: '21' };
}

const noCount = { headcount: null, sizeMin: 51 };

describe('toCoverageForm：保存した形 → 画面', () => {
  it('項目がない古いデータは空の画面になる', () => {
    expect(toCoverageForm({})).toEqual(emptyCoverageForm());
  });
  it('週の分は「40:00」で見せる。任意特定適用は voluntary', () => {
    const v = toCoverageForm({
      standardHours: { weeklyMinutes: 2400, monthlyDays: 21 },
      specificApplication: { since: '2026-10', voluntary: true, insuredCount: 12 },
      pensionFund: true,
      inKind: { housing: true, meals: false },
      bonusMonths: [12, 6],
    });
    expect(v.hours).toBe('40:00');
    expect(v.monthlyDays).toBe('21');
    expect(v.specific).toBe('voluntary');
    expect(v.specificSince).toBe('2026-10');
    expect(v.insuredCount).toBe('12');
    expect(v.bonusMonths).toEqual([6, 12]);
    expect(v.housing).toBeTrue();
  });
  it('該当した月がなければ「該当しない」', () => {
    const v = toCoverageForm({ specificApplication: { since: null, voluntary: false, insuredCount: null } });
    expect(v.specific).toBe('none');
  });
});

describe('賞与の月', () => {
  it('normalizeMonths：重複と範囲外を落として小さい順', () => {
    expect(normalizeMonths([12, 6, 6, 0, 13, 7])).toEqual([6, 7, 12]);
  });
  it('toggleMonth：あれば外す、なければ足す', () => {
    expect(toggleMonth([6, 12], 6)).toEqual([12]);
    expect(toggleMonth([12], 6)).toEqual([6, 12]);
  });
});

describe('coverageErrors：保存できない理由', () => {
  it('よくある事業所はエラーなし', () => {
    expect(coverageErrors(usual())).toEqual({});
  });
  it('所定は空でも保存できる（判定できない警告だけ）', () => {
    expect(coverageErrors(emptyCoverageForm())).toEqual({});
  });
  it('時間と日数は片方だけでは保存しない', () => {
    expect(coverageErrors({ ...usual(), monthlyDays: '' }).monthlyDays).toBe('pair');
    expect(coverageErrors({ ...usual(), hours: '' }).hours).toBe('pair');
  });
  it('読めない時間・0時間・週168時間超', () => {
    expect(coverageErrors({ ...usual(), hours: 'abc' }).hours).toBe('hours');
    expect(coverageErrors({ ...usual(), hours: '0' }).hours).toBe('hours');
    expect(coverageErrors({ ...usual(), hours: '169' }).hours).toBe('hoursRange');
  });
  it('日数は 1〜31', () => {
    expect(coverageErrors({ ...usual(), monthlyDays: '0' }).monthlyDays).toBe('days');
    expect(coverageErrors({ ...usual(), monthlyDays: '32' }).monthlyDays).toBe('days');
    expect(coverageErrors({ ...usual(), monthlyDays: '３１' }).monthlyDays).toBeUndefined();
  });
  it('該当・任意なら該当した月が必須', () => {
    expect(coverageErrors({ ...usual(), specific: 'applied' }).specificSince).toBe('since');
    expect(coverageErrors({ ...usual(), specific: 'voluntary', specificSince: '2026-10' })).toEqual({});
  });
  it('人数は空か0以上の整数', () => {
    expect(coverageErrors({ ...usual(), insuredCount: '五十' }).insuredCount).toBe('count');
    expect(coverageErrors({ ...usual(), insuredCount: '0' })).toEqual({});
  });
});

describe('coverageWarnings：注意', () => {
  it('所定が空なら「4分の3基準が判定できません」', () => {
    expect(coverageWarnings(emptyCoverageForm(), noCount)).toEqual(['noStandardHours']);
  });
  it('該当しないのに人数が基準以上（51人ちょうどから）', () => {
    expect(coverageWarnings(usual(), { headcount: 50, sizeMin: 51 })).toEqual([]);
    expect(coverageWarnings(usual(), { headcount: 51, sizeMin: 51 })).toEqual(['maybeSpecific']);
  });
  it('該当・任意を選んでいれば人数の注意は出さない', () => {
    const v: CoverageFormValue = { ...usual(), specific: 'applied', specificSince: '2026-10' };
    expect(coverageWarnings(v, { headcount: 80, sizeMin: 51 })).toEqual([]);
  });
  it('規模の要件がない（2035-10〜）・数えていないときは出さない', () => {
    expect(coverageWarnings(usual(), { headcount: 80, sizeMin: null })).toEqual([]);
    expect(coverageWarnings(usual(), noCount)).toEqual([]);
  });
  it('賞与の支払予定月が4つ以上', () => {
    expect(coverageWarnings({ ...usual(), bonusMonths: [3, 6, 9] }, noCount)).toEqual([]);
    expect(coverageWarnings({ ...usual(), bonusMonths: [3, 6, 9, 12] }, noCount)).toEqual(['bonusAsPay']);
  });
});

describe('fromCoverageForm：画面 → 保存する形', () => {
  it('週40時間・月21日', () => {
    expect(fromCoverageForm(usual())).toEqual({
      standardHours: { weeklyMinutes: 2400, monthlyDays: 21 },
      specificApplication: { since: null, voluntary: false, insuredCount: null },
      pensionFund: false,
      inKind: { housing: false, meals: false },
      bonusMonths: [],
    });
  });
  it('月で入れた時間は週に直す：月 173時間20分 → 週 40時間', () => {
    const r = fromCoverageForm({ ...usual(), hoursUnit: 'month', hours: '173:20' });
    expect(r?.standardHours?.weeklyMinutes).toBe(2400);
  });
  it('所定が空なら null', () => {
    expect(fromCoverageForm(emptyCoverageForm())?.standardHours).toBeNull();
  });
  it('「該当しない」にしたら月は消す（画面に残っていても保存しない）', () => {
    const r = fromCoverageForm({ ...usual(), specific: 'none', specificSince: '2026-10' });
    expect(r?.specificApplication.since).toBeNull();
  });
  it('任意特定適用・人数・賞与の月', () => {
    const r = fromCoverageForm({
      ...usual(),
      specific: 'voluntary',
      specificSince: '2026-10',
      insuredCount: '12',
      bonusMonths: [12, 6],
    });
    expect(r?.specificApplication).toEqual({ since: '2026-10', voluntary: true, insuredCount: 12 });
    expect(r?.bonusMonths).toEqual([6, 12]);
  });
  it('エラーがあれば null', () => {
    expect(fromCoverageForm({ ...usual(), specific: 'applied' })).toBeNull();
  });
});
