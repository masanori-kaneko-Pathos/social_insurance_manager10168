import type { ClassifyContract, ClassifyCriteria, ClassifyOffice } from '../../employees/logic/classify';
import type { CertificateLike } from '../../employees/logic/agreement';
import { personTodos, sortTodos, TodoPerson } from './todos';

// 週40時間・月20日、2026-10 から特定適用事業所（seed/test-data と同じ）
const OFFICE: ClassifyOffice = {
  standardHours: { weeklyMinutes: 2400, monthlyDays: 20 },
  specificApplication: { since: '2026-10' },
};
const CRITERIA: ClassifyCriteria[] = [
  { from: '2024-10', weeklyMinutesMin: 1200, wageMin: 88000, reducedWageMin: null },
  { from: '2026-10', weeklyMinutesMin: 1200, wageMin: null, reducedWageMin: 88000 },
];
const TODAY = '2026-11-09';

const full = (p: Partial<ClassifyContract> = {}): ClassifyContract => ({
  from: '2024-04-01', weeklyMinutes: 2400, monthlyDays: 20, scheduledWage: 280000,
  periodEnd: null, renewal: 'none', student: 'none', minimumWageReduction: false, ...p,
});
const part = (p: Partial<ClassifyContract> = {}) => full({ weeklyMinutes: 1200, monthlyDays: 12, scheduledWage: 104000, ...p });
const on = (d: string) => ({ enrolled: true, acquiredDate: d, lostDate: null });
const off = { enrolled: false, acquiredDate: null, lostDate: null };

function person(p: Partial<TodoPerson>): TodoPerson {
  return {
    id: 'X', birthDate: '1990-01-01', hireDate: '2024-04-01', retireDate: null, optInDate: null, optOutDate: null,
    health: on('2024-04-01'), pension: on('2024-04-01'), contracts: [full()], ...p,
  };
}
const todos = (p: Partial<TodoPerson>) => personTodos(person(p), OFFICE, CRITERIA, TODAY);

describe('personTodos', () => {
  it('正社員で加入している人は、やることなし', () => {
    expect(todos({})).toEqual([]);
  });
  it('T04：入社時は特定適用事業所でなく未加入。2026-10-01 から短時間労働者 → 資格取得届', () => {
    const t = todos({ hireDate: '2026-04-01', health: off, pension: off, contracts: [part({ from: '2026-04-01' })] });
    expect(t.length).toBe(1);
    expect(t[0].kind).toBe('acquire');
    expect(t[0].date).toBe('2026-10-01');
    expect(t[0].today.category).toBe('shortTime');
  });
  it('T10：2か月・更新しない → 期間を超えた日（2027-01-01）から加入。30日先までなら出ない、60日なら出る', () => {
    const p = { hireDate: '2026-11-01', health: off, pension: off, contracts: [full({ from: '2026-11-01', periodEnd: '2026-12-31' })] };
    expect(personTodos(person(p), OFFICE, CRITERIA, TODAY, { horizonDays: 30 })).toEqual([]);
    const t = todos(p);
    expect(t[0].kind).toBe('upcoming');
    expect(t[0].date).toBe('2027-01-01');
    expect(t[0].next?.category).toBe('regular');
  });
  it('T12：日雇い（10/20 入社）→ 2026-11-20 から加入', () => {
    const t = todos({ hireDate: '2026-10-20', health: off, pension: off, contracts: [full({ from: '2026-10-20', specialEmployment: 'daily' })] });
    expect(t.map((x) => [x.kind, x.date])).toEqual([['upcoming', '2026-11-20']]);
  });
  it('加入しない区分なのに加入している → lose', () => {
    const t = todos({ contracts: [part({ weeklyMinutes: 600 })] });
    expect(t[0].kind).toBe('lose');
    expect(t[0].today.reason).toBe('under20h');
  });
  it('契約が変わって、加入のまま通常 → 短時間に変わる → 区分変更届', () => {
    const t = todos({ contracts: [full(), part({ from: '2026-12-01' })] });
    expect(t.map((x) => [x.kind, x.date, x.next?.category])).toEqual([['categoryChange', '2026-12-01', 'shortTime']]);
  });
  it('契約がない人 → noContract。退職した人・入社前の人は出さない', () => {
    expect(todos({ contracts: [] })[0].kind).toBe('noContract');
    expect(todos({ retireDate: '2026-09-30' })).toEqual([]);
    expect(todos({ hireDate: '2026-12-01' })).toEqual([]);
  });
  it('事業所の所定がないときは、1人ずつは出さない（事業所の問題として呼ぶ側で出す）', () => {
    expect(personTodos(person({}), { standardHours: null }, CRITERIA, TODAY)).toEqual([]);
  });
  it('並べる順：取得届 → 喪失届 → これから（日付順）→ 判定できない', () => {
    const list = [
      ...todos({ id: 'c', contracts: [] }),
      ...todos({ id: 'b', hireDate: '2026-10-20', health: off, pension: off, contracts: [full({ from: '2026-10-20', specialEmployment: 'daily' })] }),
      ...todos({ id: 'a', hireDate: '2026-04-01', health: off, pension: off, contracts: [part({ from: '2026-04-01' })] }),
    ];
    expect(sortTodos(list).map((t) => t.employeeId)).toEqual(['a', 'b', 'c']);
  });
});

describe('personTodos：社会保障協定の適用証明書', () => {
  const us = (p: Partial<CertificateLike> = {}): CertificateLike => ({
    country: 'US', from: '2026-04-01', to: '2029-03-31', covers: 'pensionAndHealth', ...p,
  });

  it('年金・医療とも免除で、どちらも未加入 → やることなし（取得届を出さない）', () => {
    expect(todos({ health: off, pension: off, certificate: us() })).toEqual([]);
  });

  it('年金だけ免除で、健保に入っていない → 資格取得届（健保）', () => {
    const t = todos({ health: off, pension: off, certificate: us({ country: 'DE', covers: 'pension' }) });
    expect(t.map((x) => x.kind)).toEqual(['acquire']);
  });

  it('年金だけ免除で、健保だけ加入 → やることなし', () => {
    expect(todos({ pension: off, certificate: us({ country: 'DE', covers: 'pension' }) })).toEqual([]);
  });

  it('証明書があるのに厚年に入っている → 喪失届（協定）', () => {
    const t = todos({ certificate: us({ country: 'DE', covers: 'pension' }) });
    expect(t.map((x) => [x.kind, x.date])).toEqual([['agreement', '2026-04-01']]);
  });

  it('証明書が60日以内に切れる → 翌日から加入', () => {
    const t = todos({ health: off, pension: off, certificate: us({ to: '2026-12-31' }) });
    expect(t.map((x) => [x.kind, x.date])).toEqual([['certificateEnd', '2027-01-01']]);
  });

  it('証明書が切れたのに未加入 → 資格取得届', () => {
    const t = todos({ health: off, pension: off, certificate: us({ to: '2026-10-31' }) });
    expect(t.map((x) => [x.kind, x.date])).toEqual([['acquire', '2026-11-01']]);
  });
});

describe('personTodos：先に登録してあれば出さない', () => {
  it('T12：加入する日（11/20）を取得日にして登録済みなら、upcoming は出ない', () => {
    const t = todos({
      hireDate: '2026-10-20',
      health: on('2026-11-20'),
      pension: on('2026-11-20'),
      contracts: [full({ from: '2026-10-20', specialEmployment: 'daily' })],
    });
    expect(t).toEqual([]);
  });
  it('加入しない区分なのに加入している人でも、喪失日を登録済みなら lose は出ない', () => {
    const t = todos({
      contracts: [part({ weeklyMinutes: 600 })],
      health: { enrolled: true, acquiredDate: '2024-04-01', lostDate: '2026-11-21' },
      pension: { enrolled: true, acquiredDate: '2024-04-01', lostDate: '2026-11-21' },
    });
    expect(t).toEqual([]);
  });
  it('片方だけ喪失日を入れたなら、まだ lose が出る', () => {
    const t = todos({
      contracts: [part({ weeklyMinutes: 600 })],
      health: { enrolled: true, acquiredDate: '2024-04-01', lostDate: '2026-11-21' },
    });
    expect(t[0].kind).toBe('lose');
  });
});
