import { contractEndTodo, isShortTerm, myNumberTodos, noticeRequired } from './extra-todos';
import {
  ExtraPerson,
  lumpSumTodo,
  pensionMonths,
  residenceTodo,
  specificOfficeTodo,
  workPermitTodo,
} from './extra-todos';

const TODAY = '2026-11-11';
const person = (p: Partial<ExtraPerson> = {}, f: Partial<NonNullable<ExtraPerson['foreign']>> = {}): ExtraPerson => ({
  id: 'e1',
  retireDate: null,
  pension: { enrolled: true, acquiredDate: '2025-04-01', lostDate: null },
  foreign: { residenceExpiry: null, workPermit: false, workPermitWeeklyMinutes: null, ...f },
  ...p,
});

describe('residenceTodo：在留期間の満了', () => {
  it('60日以内なら出す。61日先は出さない', () => {
    expect(residenceTodo(person({}, { residenceExpiry: '2027-01-10' }), TODAY)?.date).toBe('2027-01-10');
    expect(residenceTodo(person({}, { residenceExpiry: '2027-01-11' }), TODAY)).toBeNull();
  });
  it('過ぎていても在籍中なら出す。退職した人・日本国籍の人は出さない', () => {
    expect(residenceTodo(person({}, { residenceExpiry: '2026-10-01' }), TODAY)).not.toBeNull();
    expect(residenceTodo(person({ retireDate: '2026-10-31' }, { residenceExpiry: '2026-11-20' }), TODAY)).toBeNull();
    expect(residenceTodo(person({ foreign: null }), TODAY)).toBeNull();
  });
});

describe('workPermitTodo：資格外活動の時間', () => {
  const permit = { workPermit: true, workPermitWeeklyMinutes: 28 * 60 };
  it('今の契約の週の時間が許可を超えたら出す', () => {
    const t = workPermitTodo(person({}, permit), [{ from: '2026-10-01', weeklyMinutes: 30 * 60 }], TODAY);
    expect(t?.params).toEqual({ hours: 30, limit: 28 });
    expect(t?.date).toBe('2026-10-01');
  });
  it('ちょうど28時間・許可がない・契約がこれからなら出さない', () => {
    expect(workPermitTodo(person({}, permit), [{ from: '2026-10-01', weeklyMinutes: 28 * 60 }], TODAY)).toBeNull();
    expect(workPermitTodo(person(), [{ from: '2026-10-01', weeklyMinutes: 40 * 60 }], TODAY)).toBeNull();
    expect(workPermitTodo(person({}, permit), [{ from: '2026-12-01', weeklyMinutes: 40 * 60 }], TODAY)).toBeNull();
  });
});

describe('lumpSumTodo：脱退一時金の案内', () => {
  it('被保険者期間は、取得の月〜喪失の前月', () => {
    expect(pensionMonths(person({ pension: { enrolled: true, acquiredDate: '2026-04-01', lostDate: '2026-10-01' } }))).toBe(6);
    expect(pensionMonths(person({ pension: { enrolled: true, acquiredDate: '2026-04-15', lostDate: '2026-09-30' } }))).toBe(5);
    // 喪失日が未入力なら退職日の翌日
    expect(pensionMonths(person({ retireDate: '2026-09-30', pension: { enrolled: true, acquiredDate: '2026-04-01', lostDate: null } }))).toBe(6);
  });
  it('外国籍・6か月以上・退職日が前後60日なら出す', () => {
    const p = person({ retireDate: '2026-11-30' });
    expect(lumpSumTodo(p, TODAY)?.params['months']).toBe(20); // 2025-04〜2026-11
  });
  it('6か月未満・日本国籍・退職日が遠い人は出さない', () => {
    expect(lumpSumTodo(person({ retireDate: '2026-11-30', pension: { enrolled: true, acquiredDate: '2026-07-01', lostDate: null } }), TODAY)).toBeNull();
    expect(lumpSumTodo(person({ retireDate: '2026-11-30', foreign: null }), TODAY)).toBeNull();
    expect(lumpSumTodo(person({ retireDate: '2026-08-01' }), TODAY)).toBeNull();
  });
});

describe('specificOfficeTodo：特定適用事業所の人数', () => {
  const std = { weeklyMinutes: 2400, monthlyDays: 20 };
  const full = (i: number) => ({
    birthDate: '1990-01-01',
    hireDate: '2020-04-01',
    retireDate: null,
    contracts: [{ from: `2020-04-01`, weeklyMinutes: 2400, monthlyDays: 20 }],
    _: i,
  });
  const criteria = [{ from: '2024-10', sizeMin: 51 }];
  const people = (n: number) => Array.from({ length: n }, (_, i) => full(i));
  it('特定適用でなく、4分の3基準を満たす人が51人以上なら出す', () => {
    const t = specificOfficeTodo({ standardHours: std, specificApplication: { since: null } }, people(51), criteria, '2026-11');
    expect(t?.params).toEqual({ count: 51, min: 51, how: 'app' });
    expect(specificOfficeTodo({ standardHours: std, specificApplication: { since: null } }, people(50), criteria, '2026-11')).toBeNull();
  });
  it('もう特定適用なら出さない。法人全体の人数を手で入れていれば、それを使う', () => {
    expect(specificOfficeTodo({ standardHours: std, specificApplication: { since: '2024-10' } }, people(60), criteria, '2026-11')).toBeNull();
    const t = specificOfficeTodo({ standardHours: std, specificApplication: { since: null, insuredCount: 120 } }, people(3), criteria, '2026-11');
    expect(t?.params).toEqual({ count: 120, min: 51, how: 'manual' });
  });
  it('規模の要件がない基準なら出さない', () => {
    expect(specificOfficeTodo({ standardHours: std, specificApplication: { since: null } }, people(60), [{ from: '2024-10', sizeMin: null }], '2026-11')).toBeNull();
  });
});

describe('myNumberTodos：マイナンバー', () => {
  const p = {
    id: 'e1',
    retireDate: '2024-03-31',
    health: { enrolled: true, lostDate: '2024-04-01' },
    pension: { enrolled: true, lostDate: '2024-04-01' },
  };
  const entry = (status: 'submitted' | 'registered') => ({ status, docType: null, note: null, by: 'admin' as const, updatedAt: '2026-11-10T00:00:00Z' });
  it('チェック待ち・喪失から2年', () => {
    const t = myNumberTodos([p], new Map([['e1', entry('registered')]]), '2026-11-11');
    expect(t.map((x) => x.kind)).toEqual(['myNumberDispose']);
    expect(t[0].date).toBe('2026-04-01');
    expect(myNumberTodos([{ ...p, retireDate: null }], new Map([['e1', entry('submitted')]]), '2026-11-11')[0].kind).toBe('myNumberCheck');
    expect(myNumberTodos([p], new Map(), '2026-11-11')).toEqual([]);
  });
});

describe('contractEndTodo：契約の満了', () => {
  const p = { id: 'e1', retireDate: null, hireDate: '2026-04-01' };
  const t = (from: string, periodEnd: string | null, renewal: 'none' | 'possible' | 'expected' = 'possible') => ({
    from,
    periodEnd,
    renewal,
  });

  it('満了の60日前から出す。61日先は出さない', () => {
    expect(contractEndTodo(p, [t('2026-04-01', '2027-01-10')], TODAY)?.date).toBe('2027-01-10');
    expect(contractEndTodo(p, [t('2026-04-01', '2027-01-11')], TODAY)).toBeNull();
  });
  it('過ぎても次の契約がなければ出し続ける', () => {
    expect(contractEndTodo(p, [t('2026-04-01', '2026-09-30')], TODAY)?.date).toBe('2026-09-30');
  });
  it('次の契約を入れた・期間の定めがない・退職日を入れた なら出さない', () => {
    expect(contractEndTodo(p, [t('2026-04-01', '2026-12-31'), t('2027-01-01', '2027-12-31')], TODAY)).toBeNull();
    expect(contractEndTodo(p, [t('2026-04-01', null)], TODAY)).toBeNull();
    expect(contractEndTodo({ ...p, retireDate: '2026-12-31' }, [t('2026-04-01', '2026-12-31')], TODAY)).toBeNull();
  });
  it('入社から1年を超えるなら、30日前までの予告が要る', () => {
    const r = contractEndTodo({ ...p, hireDate: '2025-12-01' }, [t('2025-12-01', '2026-12-01')], TODAY);
    expect(r?.params).toEqual({ date: '2026-12-01', notice: 'yes', noticeBy: '2026-11-01', shortTerm: 'no' });
    // ちょうど1年（4/1 入社・翌年3/31 満了）は「超えて」いない
    expect(noticeRequired('2026-04-01', [t('2026-04-01', '2027-03-31')], t('2026-04-01', '2027-03-31'))).toBeFalse();
    expect(noticeRequired('2026-04-01', [t('2026-04-01', '2027-04-01')], t('2026-04-01', '2027-04-01'))).toBeTrue();
  });
  it('3回以上の更新（4つ目の契約）なら、1年以内でも予告が要る。「更新しない」と明示していれば要らない', () => {
    const terms = [t('2026-08-01', '2026-08-31'), t('2026-09-01', '2026-09-30'), t('2026-10-01', '2026-10-31'), t('2026-11-01', '2026-11-30')];
    expect(noticeRequired('2026-08-01', terms, terms[3])).toBeTrue();
    expect(noticeRequired('2026-08-01', terms.slice(0, 3), terms[2])).toBeFalse();
    const last = t('2026-11-01', '2026-11-30', 'none');
    expect(noticeRequired('2026-08-01', [...terms.slice(0, 3), last], last)).toBeFalse();
  });
  it('2か月以内の契約に印をつける', () => {
    expect(isShortTerm(t('2026-04-10', '2026-06-09'))).toBeTrue();
    expect(isShortTerm(t('2026-04-10', '2026-06-10'))).toBeFalse();
    expect(isShortTerm(t('2026-12-31', '2027-02-27'))).toBeTrue(); // 2/28 の前の日まで
    expect(isShortTerm(t('2026-04-01', null))).toBeFalse();
  });
});
