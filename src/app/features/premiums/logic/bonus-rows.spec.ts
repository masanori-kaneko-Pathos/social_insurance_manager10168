/**
 * 手計算の練習をするなら、このファイルを開く前に
 * 「テスト一郎に 2026-12-10 に 500,000円の賞与」の本人負担を計算してみる。
 */
import { OfficeTotal } from '../../../core/models/premium';
import { PickedRate, RatesForMonth } from '../../../core/models/rates';
import {
  addTotals,
  BonusContext,
  BonusPaymentLike,
  buildBonusRow,
  collectBonusResults,
  eligibleOn,
  withDraft,
} from './bonus-rows';

// ===== 料率：東京・令和8年度（健保 9.85%・介護 1.62%・支援金 0.23%・厚年 18.3%・拠出金 0.36%） =====
const split = (employee: number, employer: number, from = '2026-03'): PickedRate => ({
  employee,
  employer,
  from,
  source: 'kyokai',
});

const tokyoR8 = (month: string): RatesForMonth => ({
  month,
  health: split(49250, 49250),
  care: split(8100, 8100),
  childSupport: split(1150, 1150, '2026-04'),
  pension: { ...split(91500, 91500, '2024-03'), source: 'national' },
  childContribution: { employee: 0, employer: 3600, from: '2024-03', source: 'national' },
});

const ctx: BonusContext = {
  ratesFor: tokyoR8,
  options: { method: 'payroll', healthRounding: 'combined' },
};

// ===== 従業員 =====
function emp(id: string, birthDate: string, acquiredDate: string, lostDate: string | null = null) {
  return {
    id,
    birthDate,
    hireDate: acquiredDate,
    retireDate: null,
    health: { enrolled: true, acquiredDate, lostDate },
    pension: { enrolled: true, acquiredDate, lostDate },
  };
}

const ichiro = emp('ichiro', '1990-05-15', '2024-04-01'); // 36歳：介護なし
const big = emp('big', '1990-01-10', '2020-04-01');
const shiro = emp('shiro', '1975-07-20', '2020-04-01', '2026-08-21'); // 8/20 退職 → 8/21 喪失

const pay = (id: string, paidDate: string, amounts: Record<string, number>): BonusPaymentLike => ({
  id,
  paidDate,
  amounts,
});

describe('buildBonusRow：基本の計算', () => {
  const payments = [pay('p1', '2026-12-10', { ichiro: 500_000 })];

  it('標準賞与額 × 料率。健保等と厚年は別々に端数処理', () => {
    const row = buildBonusRow(ichiro, payments, '2026-12-10', ctx);
    expect(row.state).toBe('ok');
    expect(row.result?.standardBonus).toBe(500_000);
    expect(row.healthEmployeeYen).toBe(25_200); // 24,625 ＋ 575（合算）
    expect(row.pensionEmployeeYen).toBe(45_750);
    expect(row.result?.employeeYen).toBe(70_950);
    expect(row.premiumTotalMilli).toBe(141_900_000); // 49,250 ＋ 1,150 ＋ 91,500
    expect(row.contributionMilli).toBe(1_800_000);
    expect(row.capped).toBeFalse();
  });

  it('1,000円未満は切り捨てて標準賞与額にする', () => {
    const row = buildBonusRow(
      ichiro,
      [pay('p1', '2026-12-10', { ichiro: 500_999 })],
      '2026-12-10',
      ctx,
    );
    expect(row.result?.standardBonus).toBe(500_000);
  });

  it('この支給で賞与がない人は empty', () => {
    expect(buildBonusRow(big, payments, '2026-12-10', ctx).state).toBe('empty');
  });
});

describe('buildBonusRow：上限（ほかの支給の分も数える）', () => {
  it('健保は年度の累計573万円。年度が変わると戻る', () => {
    const payments = [
      pay('p1', '2026-07-10', { big: 4_000_000 }),
      pay('p2', '2026-12-10', { big: 2_000_000 }),
      pay('p3', '2027-07-10', { big: 1_000_000 }),
    ];
    const dec = buildBonusRow(big, payments, '2026-12-10', ctx);
    expect(dec.result?.healthBase).toBe(1_730_000);
    expect(dec.result?.pensionBase).toBe(1_500_000);
    expect(dec.capped).toBeTrue();

    const next = buildBonusRow(big, payments, '2027-07-10', ctx);
    expect(next.result?.healthBase).toBe(1_000_000);
    expect(next.capped).toBeFalse();
  });

  it('厚年は同じ月の合計150万円', () => {
    const payments = [
      pay('p1', '2026-12-05', { big: 1_000_000 }),
      pay('p2', '2026-12-20', { big: 800_000 }),
    ];
    expect(buildBonusRow(big, payments, '2026-12-20', ctx).result?.pensionBase).toBe(500_000);
  });
});

describe('喪失月の賞与・対象者', () => {
  it('喪失月（喪失日より前）に払った賞与は counted、喪失日以後は none', () => {
    const payments = [
      pay('p1', '2026-08-10', { shiro: 300_000 }),
      pay('p2', '2026-08-25', { shiro: 300_000 }),
    ];
    expect(buildBonusRow(shiro, payments, '2026-08-10', ctx).state).toBe('counted');
    expect(buildBonusRow(shiro, payments, '2026-08-25', ctx).state).toBe('none');
  });

  it('eligibleOn：喪失月は表に出し、喪失日以後は出さない', () => {
    expect(eligibleOn(shiro, '2026-08-10')).toBeTrue();
    expect(eligibleOn(shiro, '2026-08-25')).toBeFalse();
    expect(eligibleOn(ichiro, '2024-03-31')).toBeFalse(); // 取得日より前
  });
});

describe('withDraft / collectBonusResults / addTotals', () => {
  it('withDraft：入力中の支給だけを差し替える', () => {
    const saved = [pay('p1', '2026-07-10', { ichiro: 1 }), pay('p2', '2026-12-10', { ichiro: 2 })];
    const draft = pay('p2', '2026-12-10', { ichiro: 999 });
    const list = withDraft(saved, draft);
    expect(list.length).toBe(2);
    expect(list.find((p) => p.id === 'p2')?.amounts['ichiro']).toBe(999);
  });

  it('collectBonusResults：その月の支給だけを集め、料率がない人は数える', () => {
    const payments = [
      pay('p1', '2026-07-10', { ichiro: 300_000 }),
      pay('p2', '2026-12-10', { ichiro: 500_000, big: 500_000 }),
    ];
    const c = collectBonusResults([ichiro, big], payments, ctx, (d) => d.startsWith('2026-12'));
    expect(c.results.length).toBe(2);
    expect(c.problemCount).toBe(0);

    const noHealth: BonusContext = { ...ctx, ratesFor: (m) => ({ ...tokyoR8(m), health: null }) };
    const c2 = collectBonusResults([ichiro], payments, noHealth, (d) => d.startsWith('2026-12'));
    expect(c2.results.length).toBe(0);
    expect(c2.problemCount).toBe(1);
  });

  it('addTotals：種類ごとに足す', () => {
    const a: OfficeTotal[] = [
      { category: 'health', totalYen: 100, employeeYen: 50, employerYen: 50 },
    ];
    const b: OfficeTotal[] = [{ category: 'health', totalYen: 11, employeeYen: 5, employerYen: 6 }];
    expect(addTotals(a, b)).toEqual([
      { category: 'health', totalYen: 111, employeeYen: 55, employerYen: 56 },
    ]);
  });
});

describe('産休・育休中の賞与', () => {
  it('免除：保険料はかからないが、健保の年度累計には入る（日本年金機構）', () => {
    const mom = {
      ...emp('mom', '1990-01-10', '2020-04-01'),
      leaves: [{ kind: 'childcare' as const, start: '2026-06-01', end: '2026-09-30' }],
    };
    const payments = [
      pay('p1', '2026-07-10', { mom: 4_000_000 }),
      pay('p2', '2026-12-10', { mom: 2_000_000 }),
    ];
    expect(buildBonusRow(mom, payments, '2026-07-10', ctx).state).toBe('exempt');
    // 7月の400万円が累計に入っているので、12月は 573万 − 400万 ＝ 173万円まで
    expect(buildBonusRow(mom, payments, '2026-12-10', ctx).result?.healthBase).toBe(1_730_000);
  });
});
