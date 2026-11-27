import {
  CategoryMilli,
  deductionCauses,
  DeductionContext,
  matchNotice,
  noticeCandidates,
  NoticePerson,
  ZERO_CATEGORY,
} from './diff-causes';

const ctx = (x: Partial<DeductionContext> = {}): DeductionContext => ({
  appYen: 45408,
  previousYen: 42405,
  changes: [],
  lastMonth: false,
  childSupportYen: 0,
  careYen: 0,
  settlementYen: 0,
  ...x,
});
const keys = (soft: number, x: Partial<DeductionContext> = {}) => deductionCauses(soft, ctx(x)).map((c) => c.key);

describe('差の原因：② 給与ソフトの控除額（1人ずつ。11/26）', () => {
  it('一致なら何も出さない', () => {
    expect(keys(45408)).toEqual([]);
  });

  it('給与ソフトが前の月の額のまま：改定があった人だけ', () => {
    expect(keys(42405, { changes: ['grade'] })).toEqual(['stale']);
    expect(deductionCauses(42405, ctx({ changes: ['careStart'] }))[0].params).toEqual({ changes: 'careStart', previous: 42405 });
    // 改定がないのに、たまたま前の月と同じ額 → 拾わない
    expect(keys(42405)).toEqual([]);
  });

  it('精算を含めて控除：差 ＝ この給与の月で精算した差額', () => {
    expect(keys(45408 + 3003, { settlementYen: 3003 })).toEqual(['settlement']);
  });

  it('最後の給与で2か月分', () => {
    expect(keys(90816, { lastMonth: true })).toEqual(['twoMonths']);
    expect(keys(90816)).toEqual([]);
  });

  it('支援金を控除していない・介護の有無が違う', () => {
    expect(keys(45408 - 368, { childSupportYen: 368 })).toEqual(['noChildSupport']);
    expect(keys(45408 - 2592, { careYen: 2592 })).toEqual(['care']);
    expect(keys(45408 + 2592, { careYen: 2592 })).toEqual(['care']);
  });

  it('1円の差は、ほかに原因がないときだけ端数', () => {
    expect(keys(45409)).toEqual(['rounding']);
    expect(keys(45407, { childSupportYen: 1 })).toEqual(['noChildSupport']); // 支援金が1円の人なら、そちらが先
    expect(keys(45410)).toEqual([]); // 2円は端数ではない → 分からない
  });
});

const cm = (health: number, pension: number, childContribution = 0): CategoryMilli => ({ health, pension, childContribution });
const person = (x: Partial<NoticePerson>): NoticePerson => ({
  name: '—',
  now: ZERO_CATEGORY,
  before: ZERO_CATEGORY,
  joined: false,
  left: false,
  regraded: false,
  ...x,
});

describe('差の原因：④ 告知額（欄ごと。11/26）', () => {
  // 山田：今月から等級が上がった（健保 30,000→32,256、厚年 54,900→58,560）
  const yamada = person({ name: '山田', regraded: true, before: cm(30000_000, 54900_000), now: cm(32256_000, 58560_000) });
  // 佐藤：今月から加入
  const sato = person({ name: '佐藤', joined: true, now: cm(20000_000, 36600_000, 792_000) });
  // 鈴木：前の月で喪失
  const suzuki = person({ name: '鈴木', left: true, before: cm(25000_000, 45750_000, 990_000) });

  it('候補：人がいるものだけ、告知 − アプリ の向きの額で', () => {
    const c = noticeCandidates([yamada, sato, suzuki, person({ name: '変わらない人', now: cm(1, 1), before: cm(1, 1) })], null);
    expect(c.map((x) => x.key)).toEqual(['gradePending', 'acquirePending', 'lossPending']);
    expect(c[0].yen).toEqual({ health: -2256, pension: -3660, childContribution: 0 });
    expect(c[1].yen).toEqual({ health: -20000, pension: -36600, childContribution: -792 });
    expect(c[2].yen).toEqual({ health: 25000, pension: 45750, childContribution: 990 });
    expect(c[0].names).toEqual(['山田']);
  });

  it('差に合う候補（1つ）', () => {
    const c = noticeCandidates([yamada, sato, suzuki], null);
    expect(matchNotice({ health: -20000, pension: -36600, childContribution: -792 }, c)).toEqual(['acquirePending']);
    // 切り捨ての1円のずれは合う
    expect(matchNotice({ health: -2255, pension: -3661, childContribution: 0 }, c)).toEqual(['gradePending']);
  });

  it('差に合う候補（組み合わせ）', () => {
    const c = noticeCandidates([yamada, sato, suzuki], null);
    expect(matchNotice({ health: -22256, pension: -40260, childContribution: -792 }, c).sort()).toEqual(['acquirePending', 'gradePending']);
  });

  it('賞与の届の処理待ち', () => {
    const c = noticeCandidates([], cm(98820_000, 182940_000, 3600_000));
    expect(matchNotice({ health: -98820, pension: -182940, childContribution: -3600 }, c)).toEqual(['bonusPending']);
  });

  it('料率が変わった月で、告知が前の料率のまま（11/27）', () => {
    // 田中：標準報酬は同じで、今月から料率だけが変わった（健保 30,000→30,600）
    const tanaka = person({ name: '田中', rateChanged: true, before: cm(30000_000, 54900_000), now: cm(30600_000, 54900_000) });
    const c = noticeCandidates([tanaka, yamada], null);
    expect(c.map((x) => x.key)).toEqual(['gradePending', 'ratePending']);
    expect(matchNotice({ health: -600, pension: 0, childContribution: 0 }, c)).toEqual(['ratePending']);
    // 改定もあった人は、改定の候補だけで見る（二重に数えない）
    expect(noticeCandidates([person({ ...yamada, rateChanged: true })], null).map((x) => x.key)).toEqual(['gradePending']);
  });

  it('合わなければ空（アプリでは分からない）。差がなければ空', () => {
    const c = noticeCandidates([yamada], null);
    expect(matchNotice({ health: 12345, pension: 0, childContribution: 0 }, c)).toEqual([]);
    expect(matchNotice({ health: 0, pension: 0, childContribution: 0 }, c)).toEqual([]);
  });
});
