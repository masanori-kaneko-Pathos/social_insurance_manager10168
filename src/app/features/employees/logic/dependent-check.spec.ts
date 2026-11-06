import {
  checkDependent,
  CheckedDependent,
  contractIssuesOf,
  insuredIncomeCandidate,
  isActiveOn,
  limitOf,
  needsCohabitation,
} from './dependent-check';

function dep(over: Partial<CheckedDependent> = {}): CheckedDependent {
  return {
    birthDate: '1990-05-01',
    relationship: 'spouse',
    livingTogether: true,
    remittance: null,
    remittanceTimes: null,
    annualIncome: 0,
    disabled: false,
    incomeBasis: 'estimate',
    contractIncome: null,
    from: '2026-04-01',
    to: null,
    ...over,
  };
}

describe('limitOf：年収の上限', () => {
  it('ふつうは130万円', () => {
    expect(limitOf(dep(), '2026-11-06')).toEqual({ limit: 1_300_000, reason: 'base' });
  });
  it('60歳以上・障害者は180万円', () => {
    expect(limitOf(dep({ birthDate: '1966-01-01' }), '2026-11-06').reason).toBe('senior');
    expect(limitOf(dep({ disabled: true }), '2026-11-06').reason).toBe('disabled');
  });
  it('19〜22歳（その年の12月31日の年齢）は150万円。11月に19歳になる人もその年から', () => {
    const child = dep({ relationship: 'child', birthDate: '2007-11-20' });
    expect(limitOf(child, '2026-10-01').reason).toBe('young'); // 10/1 時点は18歳、12/31 は19歳
    expect(limitOf(dep({ relationship: 'child', birthDate: '2004-12-31' }), '2026-01-10').reason).toBe('young'); // 12/31 に22歳
  });
  it('配偶者・2025-10-01 より前の判定・23歳になる年は対象外', () => {
    expect(limitOf(dep({ birthDate: '2005-01-01' }), '2026-01-10').reason).toBe('base'); // 配偶者
    expect(limitOf(dep({ relationship: 'child', birthDate: '2005-01-01' }), '2025-09-30').reason).toBe('base');
    expect(limitOf(dep({ relationship: 'child', birthDate: '2003-01-01' }), '2026-01-10').reason).toBe('base'); // 12/31 で23歳
  });
});

describe('needsCohabitation：同居が要る続柄', () => {
  it('配偶者・子・孫・兄弟姉妹・直系尊属は要らない。義父母・連れ子・その他は要る', () => {
    expect(needsCohabitation('spouse')).toBeFalse();
    expect(needsCohabitation('grandparent')).toBeFalse();
    expect(needsCohabitation('parentInLaw')).toBeTrue();
    expect(needsCohabitation('otherChild')).toBeTrue();
    expect(needsCohabitation('other')).toBeTrue();
  });
});

describe('checkDependent', () => {
  const today = '2026-11-06';

  it('同居・収入なしの配偶者（35歳）は基準内で、第3号', () => {
    const r = checkDependent(dep(), 4_500_000, today);
    expect(r.level).toBe('ok');
    expect(r.thirdInsured).toBeTrue();
  });

  it('同居：被保険者の半分以上は要確認、被保険者より多ければ基準外', () => {
    expect(checkDependent(dep({ annualIncome: 1_200_000 }), 2_000_000, today).issues).toEqual(['halfOrMore']);
    expect(checkDependent(dep({ annualIncome: 1_200_000 }), 1_000_000, today).level).toBe('ng');
  });

  it('同居で被保険者の年収がわからなければ要確認', () => {
    expect(checkDependent(dep(), null, today).issues).toEqual(['insuredIncomeUnknown']);
  });

  it('別居：仕送りの年額（1回 × 回数）より少なければ基準内', () => {
    const d = dep({ relationship: 'parent', birthDate: '1955-01-01', livingTogether: false, annualIncome: 1_500_000 });
    expect(checkDependent({ ...d, remittance: 150_000, remittanceTimes: 12 }, null, today).level).toBe('ok'); // 180万 > 150万
    expect(checkDependent({ ...d, remittance: 100_000, remittanceTimes: 12 }, null, today).issues).toEqual(['overRemittance']);
    expect(checkDependent(d, null, today).issues).toEqual(['noRemittance']);
  });

  it('同居が要る続柄で別居なら基準外', () => {
    const d = dep({ relationship: 'parentInLaw', livingTogether: false, remittance: 200_000, remittanceTimes: 12 });
    expect(checkDependent(d, null, today).issues).toEqual(['cohabitationRequired']);
  });

  it('上限以上・75歳以上は基準外', () => {
    expect(checkDependent(dep({ annualIncome: 1_300_000 }), 9_000_000, today).issues).toEqual(['overLimit']);
    expect(checkDependent(dep({ relationship: 'parent', birthDate: '1950-01-01' }), 9_000_000, today).issues).toEqual(['age75']);
  });

  it('20歳の子が年140万円：150万円の特例で基準内（第3号ではない）', () => {
    const r = checkDependent(dep({ relationship: 'child', birthDate: '2006-04-01', annualIncome: 1_400_000 }), 6_000_000, today);
    expect(r.level).toBe('ok');
    expect(r.limitReason).toBe('young');
    expect(r.thirdInsured).toBeFalse();
  });

  describe('労働契約の方式（2026-04-01 から）', () => {
    const contract = { annualWage: 1_250_000, periodEnd: null, hoursClear: true, allowancesClear: true };

    it('使えれば契約の年収で判定（見込みが基準を超えていても）', () => {
      const d = dep({ annualIncome: 1_350_000, incomeBasis: 'contract', contractIncome: contract });
      const r = checkDependent(d, 6_000_000, today);
      expect(r.incomeSource).toBe('contract');
      expect(r.income).toBe(1_250_000);
      expect(r.level).toBe('ok');
    });

    it('使えない理由があれば、見込みの年収で判定して理由を出す', () => {
      const d = dep({
        annualIncome: 1_350_000,
        incomeBasis: 'contract',
        contractIncome: { ...contract, periodEnd: '2027-03-30', hoursClear: false },
      });
      const r = checkDependent(d, 6_000_000, today);
      expect(r.incomeSource).toBe('estimate');
      expect(r.contractIssues).toEqual(['shortContract', 'unclearHours']);
      expect(r.issues).toEqual(['overLimit']);
    });

    it('契約期間：扶養に入った日から丸1年ならよい／2026-04-01 より前は使えない', () => {
      const d = dep({ incomeBasis: 'contract', contractIncome: { ...contract, periodEnd: '2027-03-31' } });
      expect(contractIssuesOf(d, today)).toEqual([]);
      expect(contractIssuesOf(d, '2026-03-31')).toEqual(['notYet']);
    });
  });
});

describe('isActiveOn', () => {
  it('入った日から、外れた日の前日まで', () => {
    const d = { from: '2026-04-01', to: '2026-10-01' };
    expect(isActiveOn(d, '2026-04-01')).toBeTrue();
    expect(isActiveOn(d, '2026-09-30')).toBeTrue();
    expect(isActiveOn(d, '2026-10-01')).toBeFalse();
  });
});

describe('insuredIncomeCandidate：被保険者の年収の候補', () => {
  it('12か月分あれば合計＋直近1年の賞与', () => {
    const payrolls = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.UTC(2025, 8 + i, 1)); // 2025-09〜2026-10
      return { paidMonth: d.toISOString().slice(0, 7), amount: 300_000 };
    });
    const bonuses = [
      { paidDate: '2025-11-06', amount: 999_999 }, // ちょうど1年前は入れない
      { paidDate: '2025-12-10', amount: 500_000 },
      { paidDate: '2026-07-10', amount: 500_000 },
    ];
    expect(insuredIncomeCandidate({ payrolls, bonuses }, '2026-11-06')).toEqual({ amount: 4_600_000, months: 12 });
  });
  it('足りなければ平均 × 12、なければ null', () => {
    const payrolls = [
      { paidMonth: '2026-09', amount: 250_000 },
      { paidMonth: '2026-10', amount: 350_000 },
    ];
    expect(insuredIncomeCandidate({ payrolls, bonuses: [] }, '2026-11-06')).toEqual({ amount: 3_600_000, months: 2 });
    expect(insuredIncomeCandidate({ payrolls: [], bonuses: [] }, '2026-11-06')).toBeNull();
  });
});
