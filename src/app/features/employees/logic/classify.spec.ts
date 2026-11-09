import { monthsPeriodEnd } from '../../../shared/utils/date';
import {
  classify,
  ClassifyContract,
  ClassifyCriteria,
  ClassifyOffice,
  ClassifyPerson,
} from './classify';

// 週40時間・月20日、2024-10 から特定適用事業所
const OFFICE: ClassifyOffice = {
  standardHours: { weeklyMinutes: 2400, monthlyDays: 20 },
  specificApplication: { since: '2024-10' },
};
// seed/master-criteria.json の一部
const CRITERIA: ClassifyCriteria[] = [
  { from: '2024-10', weeklyMinutesMin: 1200, wageMin: 88000, reducedWageMin: null },
  { from: '2026-10', weeklyMinutesMin: 1200, wageMin: null, reducedWageMin: 88000 },
];

function full(p: Partial<ClassifyContract> = {}): ClassifyContract {
  return {
    from: '2026-08-01',
    weeklyMinutes: 2400,
    monthlyDays: 20,
    scheduledWage: 250000,
    periodEnd: null,
    renewal: 'none',
    student: 'none',
    minimumWageReduction: false,
    ...p,
  };
}
/** 週20時間・月12日のパート（4分の3未満） */
const part = (p: Partial<ClassifyContract> = {}) =>
  full({ weeklyMinutes: 1200, monthlyDays: 12, scheduledWage: 100000, ...p });

function person(contracts: ClassifyContract[], p: Partial<ClassifyPerson> = {}): ClassifyPerson {
  return { birthDate: '1990-05-15', optInDate: null, optOutDate: null, contracts, ...p };
}

const at = (pp: ClassifyPerson, date: string, office = OFFICE) => {
  const r = classify(pp, office, CRITERIA, date);
  return `${r.category}:${r.reason}`;
};

describe('monthsPeriodEnd：暦月で数えた期間の最後の日（Q&A 問8）', () => {
  it('同じ日の前日', () => {
    expect(monthsPeriodEnd('2026-08-01', 2)).toBe('2026-09-30');
    expect(monthsPeriodEnd('2026-08-15', 2)).toBe('2026-10-14');
    expect(monthsPeriodEnd('2026-11-10', 1)).toBe('2026-12-09');
  });
  it('同じ日がない月は月末', () => {
    expect(monthsPeriodEnd('2026-12-31', 2)).toBe('2027-02-28');
    expect(monthsPeriodEnd('2027-12-31', 2)).toBe('2028-02-29');
  });
});

describe('classify：働き方', () => {
  it('契約がなければ判定できない', () => {
    expect(at(person([]), '2026-11-01')).toBe('unknown:noContract');
  });
  it('4分の3以上は通常の労働者', () => {
    expect(at(person([full()]), '2026-11-01')).toBe('regular:threeQuarters');
  });
  it('事業所の所定がなければ判定できない', () => {
    expect(at(person([full()]), '2026-11-01', { standardHours: null })).toBe('unknown:noStandard');
  });
  it('4分の3未満で特定適用事業所 → 短時間労働者。特定適用事業所でなければ対象外', () => {
    expect(at(person([part()]), '2026-11-01')).toBe('shortTime:shortTimeRequirements');
    const notSpecific = { ...OFFICE, specificApplication: { since: null } };
    expect(at(person([part()]), '2026-11-01', notSpecific)).toBe('excluded:notSpecific');
  });
  it('該当した月より前は特定適用事業所ではない', () => {
    const since = { ...OFFICE, specificApplication: { since: '2027-10' } };
    expect(at(person([part()]), '2027-09-30', since)).toBe('excluded:notSpecific');
    expect(at(person([part()]), '2027-10-01', since)).toBe('shortTime:shortTimeRequirements');
  });
  it('週20時間未満・昼間の学生は対象外。夜間・通信・休学中は加入', () => {
    expect(at(person([part({ weeklyMinutes: 1199 })]), '2026-11-01')).toBe('excluded:under20h');
    expect(at(person([part({ student: 'daytime' })]), '2026-11-01')).toBe('excluded:student');
    expect(at(person([part({ student: 'other' })]), '2026-11-01')).toBe('shortTime:shortTimeRequirements');
  });
  it('賃金要件は 2026-09 まで（8.8万円未満は対象外）', () => {
    const low = person([part({ scheduledWage: 80000 })]);
    expect(at(low, '2026-09-30')).toBe('excluded:lowWage');
    expect(at(low, '2026-10-01')).toBe('shortTime:shortTimeRequirements');
  });
  it('理由は働き方を先に見る（20時間未満で2か月以内なら under20h）', () => {
    const c = part({ weeklyMinutes: 600, periodEnd: '2026-09-30' });
    expect(at(person([c]), '2026-08-15')).toBe('excluded:under20h');
  });
});

describe('classify：特定減額特例対象者（R2）', () => {
  const reduced = part({ scheduledWage: 80000, minimumWageReduction: true });
  it('申出がなければ対象外、申出の日から加入、喪失の申出の日から対象外', () => {
    const p = person([reduced], { optInDate: '2026-11-10', optOutDate: '2027-01-01' });
    expect(at(p, '2026-11-09')).toBe('excluded:reducedWage');
    expect(at(p, '2026-11-10')).toBe('reducedWage:optedIn');
    expect(at(p, '2027-01-01')).toBe('excluded:reducedWage');
  });
  it('所定内賃金が8.8万円以上・許可がない人は、ふつうの短時間労働者', () => {
    expect(at(person([{ ...reduced, scheduledWage: 88000 }]), '2026-11-01')).toBe('shortTime:shortTimeRequirements');
    expect(at(person([{ ...reduced, minimumWageReduction: false }]), '2026-11-01')).toBe('shortTime:shortTimeRequirements');
  });
  it('70歳以上は特定減額特例の対象ではない', () => {
    // 1956-08-01 生まれ：70歳到達日は 2026-07-31
    expect(at(person([reduced], { birthDate: '1956-08-01' }), '2026-11-01')).toBe('shortTime:shortTimeRequirements');
  });
});

describe('classify：2か月以内の契約（Q&A 問2・4〜9、健保法3条1項2号ロ）', () => {
  const short = (p: Partial<ClassifyContract> = {}) => full({ periodEnd: '2026-09-30', ...p });

  it('更新しない・実績もない → 期間の中は対象外', () => {
    expect(at(person([short()]), '2026-08-15')).toBe('excluded:shortTerm');
  });
  it('定めた期間を超えて続けて使われたら、超えた日から加入', () => {
    expect(at(person([short()]), '2026-09-30')).toBe('excluded:shortTerm');
    expect(at(person([short()]), '2026-10-01')).toBe('regular:threeQuarters');
    // 次の契約も2か月以内・更新しない、でも加入のまま
    const renewed = person([short(), short({ from: '2026-10-01', periodEnd: '2026-11-30' })]);
    expect(at(renewed, '2026-10-15')).toBe('regular:threeQuarters');
  });
  it('「更新する場合がある」・同様の契約の実績 → 最初から加入（問2）', () => {
    expect(at(person([short({ renewal: 'possible' })]), '2026-08-01')).toBe('regular:threeQuarters');
    expect(at(person([short({ renewalPrecedent: true })]), '2026-08-01')).toBe('regular:threeQuarters');
  });
  it('労使が超えて使わないと合意していれば対象外（問2 ただし書き）', () => {
    const c = short({ renewal: 'possible', noExtensionAgreed: true });
    expect(at(person([c]), '2026-08-15')).toBe('excluded:shortTerm');
  });
  it('あとで見込みが生じた → 合意した日（新しい行）から加入（問4〜6）', () => {
    const p = person([short(), short({ from: '2026-08-20', renewal: 'possible' })]);
    expect(at(p, '2026-08-19')).toBe('excluded:shortTerm');
    expect(at(p, '2026-08-20')).toBe('regular:threeQuarters');
  });
  it('一度加入したら、更新しないことになっても期間の途中で外れない（問7）', () => {
    const p = person([short({ renewal: 'possible' }), short({ from: '2026-08-20', renewal: 'none' })]);
    expect(at(p, '2026-08-25')).toBe('regular:threeQuarters');
  });
  it('2か月は暦月で数える（8/15〜10/14 は2か月以内、10/15 までなら超える）', () => {
    expect(at(person([short({ from: '2026-08-15', periodEnd: '2026-10-14' })]), '2026-09-01')).toBe('excluded:shortTerm');
    expect(at(person([short({ from: '2026-08-15', periodEnd: '2026-10-15' })]), '2026-09-01')).toBe('regular:threeQuarters');
  });
  it('要件を満たさない働き方から変わったときは、変わった日からの契約で判断（問9）', () => {
    const p = person([
      part({ from: '2025-04-01', weeklyMinutes: 600 }), // 週10時間（対象外）
      part({ from: '2026-11-01', weeklyMinutes: 1500, periodEnd: '2026-12-31' }), // 週25時間・2か月・更新しない
      part({ from: '2027-01-01', weeklyMinutes: 1500 }), // 期間の定めなし
    ]);
    expect(at(p, '2026-11-15')).toBe('excluded:shortTerm');
    expect(at(p, '2027-01-05')).toBe('shortTime:shortTimeRequirements');
  });
});

describe('classify：日雇い・季節的業務・臨時的事業', () => {
  it('日雇いは1か月を超えて続けて使われた日から加入', () => {
    const p = person([full({ from: '2026-11-10', specialEmployment: 'daily' })]);
    expect(at(p, '2026-12-09')).toBe('excluded:daily');
    expect(at(p, '2026-12-10')).toBe('regular:threeQuarters');
  });
  it('季節的業務は4か月以内なら対象外、超える予定なら最初から加入', () => {
    const c = full({ from: '2026-04-01', specialEmployment: 'seasonal' });
    expect(at(person([{ ...c, periodEnd: '2026-07-31' }]), '2026-04-01')).toBe('excluded:seasonal');
    expect(at(person([{ ...c, periodEnd: '2026-08-01' }]), '2026-04-01')).toBe('regular:threeQuarters');
  });
  it('臨時的事業は6か月以内なら対象外', () => {
    const c = full({ from: '2026-04-01', specialEmployment: 'temporaryBusiness' });
    expect(at(person([{ ...c, periodEnd: '2026-09-30' }]), '2026-04-01')).toBe('excluded:temporaryBusiness');
    expect(at(person([{ ...c, periodEnd: '2026-10-01' }]), '2026-04-01')).toBe('regular:threeQuarters');
  });
});
