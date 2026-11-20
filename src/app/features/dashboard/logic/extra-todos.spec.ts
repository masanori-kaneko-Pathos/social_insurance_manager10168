import { childcareSpecialEnd, childcareSpecialTodo, childStartsOf } from './extra-todos';
import { acquireAmountTodo, actualHoursThreshold, actualHoursTodo, adjustmentDeadlineTodo, insurerChangeTodos, ratesMissingTodo, bonusNoneTodos, bonusCumulativeTodos, bonusReportTodos, enrollmentReportTodos, CumulativePerson } from './extra-todos';
import { cardReturnTodo, contractEndTodo, isShortTerm, myNumberTodos, noticeRequired, retireGuideTodo, voluntaryEligible } from './extra-todos';
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

  it('家族の提出もチェック待ちにまとめる（1人1件）', () => {
    const active = { ...p, retireDate: null };
    const family = new Map([['e1', new Map([['d1', entry('submitted')], ['d2', entry('submitted')]])]]);
    const t = myNumberTodos([active], new Map([['e1', entry('submitted')]]), '2026-11-11', family);
    expect(t.length).toBe(1);
    expect(t[0].params).toEqual({ self: 'yes', family: 2 });
    const onlyFamily = myNumberTodos([active], new Map([['e1', entry('registered')]]), '2026-11-11', family);
    expect(onlyFamily[0].params['self']).toBe('no');
  });

  it('廃棄のときは、残っている家族の番号の件数も出す', () => {
    const family = new Map([['e1', new Map([['d1', entry('registered')]])]]);
    const t = myNumberTodos([p], new Map([['e1', entry('registered')]]), '2026-11-11', family);
    expect(t[0].params['family']).toBe(1);
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

describe('cardReturnTodo：資格確認書の回収', () => {
  const p = { id: 'e1', retireDate: '2026-11-30', needsConfirmationCard: true, health: { enrolled: true, lostDate: null } };
  it('協会けんぽで交付されている人の喪失（喪失日は退職日の翌日）', () => {
    expect(cardReturnTodo(p, 'kyokai', TODAY)?.date).toBe('2026-12-01');
  });
  it('組合健保・交付なし・60日より前の喪失は出さない', () => {
    expect(cardReturnTodo(p, 'kumiai', TODAY)).toBeNull();
    expect(cardReturnTodo({ ...p, needsConfirmationCard: false }, 'kyokai', TODAY)).toBeNull();
    expect(cardReturnTodo({ ...p, retireDate: '2026-08-01' }, 'kyokai', TODAY)).toBeNull();
  });
});

describe('retireGuideTodo：退職する人への案内', () => {
  const p = {
    id: 'e1',
    retireDate: '2026-11-30',
    retireReason: 'resign' as const,
    health: { enrolled: true, acquiredDate: '2026-10-01' },
  };
  it('継続して2か月以上なら任意継続の案内（期限は退職日＋20日）', () => {
    const t = retireGuideTodo(p, 'kyokai', TODAY);
    expect(t?.params).toEqual({ date: '2026-11-30', voluntary: 'yes', deadline: '2026-12-20', insurer: 'kyokai' });
  });
  it('2か月に届かなければ任意継続はできない（10/2 取得・11/30 退職 → 喪失日 12/1 は 12/2 より前）', () => {
    expect(voluntaryEligible({ ...p, health: { enrolled: true, acquiredDate: '2026-10-02' } })).toBeFalse();
  });
  it('死亡・転勤・30日より前の退職は出さない', () => {
    expect(retireGuideTodo({ ...p, retireReason: 'death' }, 'kyokai', TODAY)).toBeNull();
    expect(retireGuideTodo({ ...p, retireReason: 'transfer' }, 'kyokai', TODAY)).toBeNull();
    expect(retireGuideTodo({ ...p, retireDate: '2026-10-11' }, 'kyokai', TODAY)).toBeNull();
  });
});

describe('ratesMissingTodo：来年度の料率がまだ（11/16）', () => {
  it('2〜4月で、その年の3月分からの料率がなければ出す', () => {
    const t = ratesMissingTodo('kyokai', ['2025-03', '2026-03'], '2027-02-01');
    expect(t?.date).toBe('2027-03-01');
    expect(t?.params).toEqual({ insurer: 'kyokai', year: '2027' });
    expect(ratesMissingTodo('kumiai', [], '2027-04-30')?.kind).toBe('ratesMissing');
  });
  it('3月分（4月分から変わる組合は4月分）からの料率があれば出さない', () => {
    expect(ratesMissingTodo('kyokai', ['2026-03', '2027-03'], '2027-02-10')).toBeNull();
    expect(ratesMissingTodo('kumiai', ['2027-04'], '2027-03-10')).toBeNull();
  });
  it('1月・5月以後は出さない', () => {
    expect(ratesMissingTodo('kyokai', ['2026-03'], '2027-01-31')).toBeNull();
    expect(ratesMissingTodo('kyokai', ['2026-03'], '2027-05-01')).toBeNull();
  });
});

describe('adjustmentDeadlineTodo：保険料調整制度の申出の期限（11/16）', () => {
  it('期限の月の末日が90日以内なら出す。91日先は出さない', () => {
    expect(adjustmentDeadlineTodo('2028-09', false, '2028-07-02')?.date).toBe('2028-09-30');
    expect(adjustmentDeadlineTodo('2028-09', false, '2028-07-01')).toBeNull();
  });
  it('期限の当日までは出す。過ぎたら出さない', () => {
    expect(adjustmentDeadlineTodo('2028-09', false, '2028-09-30')).not.toBeNull();
    expect(adjustmentDeadlineTodo('2028-09', false, '2028-10-01')).toBeNull();
  });
  it('もう使っている・対象でない事業所は出さない', () => {
    expect(adjustmentDeadlineTodo('2028-09', true, '2028-09-01')).toBeNull();
    expect(adjustmentDeadlineTodo(null, false, '2028-09-01')).toBeNull();
  });
});

describe('insurerChangeTodos：保険者の切り替え（11/17）', () => {
  const kyokai = { type: 'kyokai' as const, kumiaiName: null };
  const kumiai = (n: string) => ({ type: 'kumiai' as const, kumiaiName: n });
  const office = (rows: [string, string, ReturnType<typeof kumiai> | typeof kyokai][]) => ({
    prefecture: rows[rows.length - 1][1],
    healthInsurer: rows[rows.length - 1][2],
    insurerHistory: rows.map(([from, prefecture, healthInsurer]) => ({ from, prefecture, healthInsurer })),
  });
  const toKumiai = office([['0000-01', '13', kyokai], ['2027-04', '13', kumiai('A健保')]]);
  it('協会けんぽ → 組合：2か月前から出る（日付は切り替える月の1日）', () => {
    expect(insurerChangeTodos(toKumiai, '2027-01-31')).toEqual([]);
    expect(insurerChangeTodos(toKumiai, '2027-02-01')).toEqual([
      { kind: 'insurerChange', employeeId: null, date: '2027-04-01', params: { direction: 'toKumiai', month: '2027-04', from: '', to: 'A健保' } },
    ]);
  });
  it('切り替えた月の3か月後の月末まで出る', () => {
    expect(insurerChangeTodos(toKumiai, '2027-07-31').length).toBe(1);
    expect(insurerChangeTodos(toKumiai, '2027-08-01')).toEqual([]);
  });
  it('組合 → 協会けんぽ、組合 → 別の組合', () => {
    const o = office([['0000-01', '13', kumiai('A健保')], ['2027-04', '13', kumiai('B健保')], ['2027-10', '13', kyokai]]);
    expect(insurerChangeTodos(o, '2027-04-10').map((t) => t.params['direction'])).toEqual(['kumiaiToKumiai']);
    expect(insurerChangeTodos(o, '2027-09-01').map((t) => [t.params['direction'], t.params['from']])).toEqual([['toKyokai', 'B健保']]);
  });
  it('協会けんぽのまま都道府県だけ変わったときは出さない', () => {
    expect(insurerChangeTodos(office([['0000-01', '13', kyokai], ['2027-04', '27', kyokai]]), '2027-04-01')).toEqual([]);
  });
  it('同じ組合のまま都道府県だけ変わったときも出さない', () => {
    expect(insurerChangeTodos(office([['0000-01', '13', kumiai('A健保')], ['2027-04', '27', kumiai('A健保')]]), '2027-04-01')).toEqual([]);
  });
});

describe('賞与不支給報告書（11/19）', () => {
  const pays = [{ paidDate: '2026-07-10', amounts: { e1: 300000 } }];
  it('先月・先々月の支払予定月に払っていなければ、翌月末日を期限に出す', () => {
    expect(bonusNoneTodos([9, 10], pays, '2026-11-19').map((t) => t.date)).toEqual(['2026-10-31', '2026-11-30']);
  });
  it('予定月に払っていれば出さない。予定月でなければ出さない', () => {
    expect(bonusNoneTodos([10], [{ paidDate: '2026-10-20', amounts: { e1: 1 } }], '2026-11-19')).toEqual([]);
    expect(bonusNoneTodos([6, 12], pays, '2026-11-19')).toEqual([]);
  });
});

describe('enrollmentReportTodos：資格取得届・資格喪失届（11/20）', () => {
  const en = (acquiredDate: string | null, lostDate: string | null = null) => ({ enrolled: true, acquiredDate, lostDate });
  it('11/2 取得 → 取得届。11/15 退職 → 喪失日 11/16 で喪失届', () => {
    const t = enrollmentReportTodos({ id: 'a', birthDate: '1990-01-01', retireDate: '2026-11-15', health: en('2026-11-02'), pension: en('2026-11-02') }, '2026-11-20');
    expect(t.map((x) => [x.kind, x.date])).toEqual([
      ['acquireReport', '2026-11-02'],
      ['lossReport', '2026-11-16'],
    ]);
  });
  it('60日より前・これからの日は出さない。加入していない保険は見ない', () => {
    expect(enrollmentReportTodos({ id: 'a', birthDate: '1990-01-01', retireDate: null, health: en('2026-09-20'), pension: en('2026-12-01') }, '2026-11-20')).toEqual([]);
    expect(
      enrollmentReportTodos({ id: 'a', birthDate: '1990-01-01', retireDate: '2026-11-01', health: { enrolled: false, acquiredDate: '2026-11-01', lostDate: null }, pension: { enrolled: false, acquiredDate: null, lostDate: null } }, '2026-11-20'),
    ).toEqual([]);
  });
  it('11/10 に75歳：記録に喪失日がなくても、健保の喪失届1件（厚年はもうない）', () => {
    const t = enrollmentReportTodos(
      { id: 'a', birthDate: '1951-11-10', retireDate: null, health: en('2013-04-01'), pension: { enrolled: false, acquiredDate: null, lostDate: null } },
      '2026-11-20',
    );
    expect(t.map((x) => [x.kind, x.date])).toEqual([['lossReport', '2026-11-10']]);
  });
  it('70歳到達（厚年の喪失）は年齢の To-do に任せて出さない', () => {
    expect(enrollmentReportTodos({ id: 'a', birthDate: '1956-11-01', retireDate: null, health: en('2016-04-01'), pension: en('2016-04-01') }, '2026-11-20')).toEqual([]);
  });
});

describe('bonusReportTodos：賞与支払届（11/20）', () => {
  it('支払日ごとに1件。同じ日の支給はまとめて人数を数える', () => {
    const t = bonusReportTodos(
      [
        { paidDate: '2026-11-10', amounts: { a: 2000000, b: 0 } },
        { paidDate: '2026-11-10', amounts: { a: 1000, c: 300000 } },
        { paidDate: '2026-10-25', amounts: { d: 100000 } },
      ],
      '2026-11-20',
    );
    expect(t.map((x) => [x.date, x.params['count']])).toEqual([
      ['2026-10-25', 1],
      ['2026-11-10', 2],
    ]);
  });
  it('60日より前・これからの支払・0円だけ・社会保険の対象外の項目は出さない', () => {
    expect(
      bonusReportTodos(
        [
          { paidDate: '2026-07-10', amounts: { a: 1 } },
          { paidDate: '2026-12-10', amounts: { a: 1 } },
          { paidDate: '2026-11-01', amounts: { a: 0 } },
          { paidDate: '2026-11-02', amounts: { a: 1 }, rule: { treatments: [{ fromYear: 0, treatment: 'none' }] } as never },
        ],
        '2026-11-20',
      ),
    ).toEqual([]);
  });
});

describe('標準賞与額の累計申出（11/19）', () => {
  const emp = {
    id: 'e1', birthDate: '1990-01-01', hireDate: '2026-06-01', retireDate: null,
    health: { enrolled: true, acquiredDate: '2026-06-01', lostDate: null },
    pension: { enrolled: true, acquiredDate: '2026-06-01', lostDate: null },
    priorBonusTotals: { '2026': 5000000 },
  } as unknown as CumulativePerson;
  it('前の事業所の分と合わせて上限を超えたら出す', () => {
    const t = bonusCumulativeTodos(emp, [{ id: 'b', paidDate: '2026-07-10', amounts: { e1: 800500 } }], '2026-11-19');
    expect(t.length).toBe(1);
    expect(t[0].params['total']).toBe('5,800,000');
  });
  it('超えなければ出さない', () => {
    expect(bonusCumulativeTodos(emp, [{ id: 'b', paidDate: '2026-07-10', amounts: { e1: 700000 } }], '2026-11-19')).toEqual([]);
  });
});

describe('実際の労働時間（調査指摘事例集 事例1。11/19）', () => {
  const p = { id: 'e1', health: { enrolled: false }, pension: { enrolled: false } };
  const nums = { stdWeeklyMinutes: 40 * 60, minWeeklyMinutes: 20 * 60 } as never;
  it('基準：特定適用事業所でなければ所定の4分の3、特定適用事業所で20時間未満なら20時間。加入しているなら見ない', () => {
    expect(actualHoursThreshold({ category: 'excluded', reason: 'notSpecific', nums })).toBe(30 * 60);
    expect(actualHoursThreshold({ category: 'excluded', reason: 'under20h', nums })).toBe(20 * 60);
    expect(actualHoursThreshold({ category: 'shortTime', reason: 'shortTimeRequirements', nums })).toBeNull();
    expect(actualHoursThreshold({ category: 'excluded', reason: 'student', nums })).toBeNull();
  });
  it('連続する2か月とも週20時間以上 → 3か月目の初日に取得の To-do', () => {
    // 月 90時間 → 週 20.7時間
    const t = actualHoursTodo(p, 20 * 60, [{ paidMonth: '2026-09', workMinutes: 90 * 60 }, { paidMonth: '2026-10', workMinutes: 92 * 60 }]);
    expect(t?.date).toBe('2026-11-01');
    expect(t?.params['h1']).toBe(20.8);
  });
  it('1か月でも基準未満・実労働時間がない・月が続いていない・加入済みなら出さない', () => {
    expect(actualHoursTodo(p, 20 * 60, [{ paidMonth: '2026-09', workMinutes: 80 * 60 }, { paidMonth: '2026-10', workMinutes: 92 * 60 }])).toBeNull();
    expect(actualHoursTodo(p, 20 * 60, [{ paidMonth: '2026-09', workMinutes: null }, { paidMonth: '2026-10', workMinutes: 92 * 60 }])).toBeNull();
    expect(actualHoursTodo(p, 20 * 60, [{ paidMonth: '2026-08', workMinutes: 92 * 60 }, { paidMonth: '2026-10', workMinutes: 92 * 60 }])).toBeNull();
    expect(actualHoursTodo({ ...p, health: { enrolled: true } }, 20 * 60, [{ paidMonth: '2026-09', workMinutes: 92 * 60 }, { paidMonth: '2026-10', workMinutes: 92 * 60 }])).toBeNull();
  });
});

describe('資格取得時の報酬月額（調査指摘事例集 事例2。11/19）', () => {
  const p = { id: 'e1', health: { enrolled: true, acquiredDate: '2025-04-01' }, pension: { enrolled: true, acquiredDate: '2025-04-01' } };
  it('取得届は基本給＋A・B手当の214,000円。5月の給与から通勤・住宅手当（236,000円）→ To-do', () => {
    const t = acquireAmountTodo(p, 214000, [{ paidMonth: '2025-04', fixed: 214000 }, { paidMonth: '2025-05', fixed: 236000 }]);
    expect(t?.params['month']).toBe('2025-05');
    expect(t?.params['fixed']).toBe('236,000');
  });
  it('手当まで入れた236,000円で届けていれば出さない。取得から4か月目より後の変動も見ない', () => {
    expect(acquireAmountTodo(p, 236000, [{ paidMonth: '2025-05', fixed: 236000 }])).toBeNull();
    expect(acquireAmountTodo(p, 214000, [{ paidMonth: '2025-08', fixed: 250000 }])).toBeNull();
  });
});

describe('養育期間標準報酬月額特例（厚生年金保険法26条。11/19）', () => {
  const p = { id: 'e1', retireDate: null, pension: { enrolled: true, acquiredDate: '2020-04-01' } };
  // 2025-05-20 に出産。前月（2025-04）は 300,000円。育休から戻って 2026-07 分から 220,000円に
  const history = [
    { from: '2020-04', pension: 300000 },
    { from: '2026-07', pension: 220000 },
  ];

  it('子が3歳になるまでの最後の月は、3歳の誕生日の月の前月', () => {
    expect(childcareSpecialEnd('2025-05-20')).toBe('2028-04');
    expect(childcareSpecialEnd('2025-01-01')).toBe('2027-12');
  });

  it('生まれる前の月より下がった月があれば出す（前の額・下がった月・額）', () => {
    const t = childcareSpecialTodo(p, ['2025-05-20'], history, '2026-11-19')!;
    expect(t.kind).toBe('childcareSpecial');
    const { base, pre, month, now, until } = t.params;
    expect({ base, pre, month, now, until }).toEqual({ base: '2025-04', pre: '300,000', month: '2026-07', now: '220,000', until: '2028-04' });
  });

  it('下がっていない・上がった人には出さない', () => {
    expect(childcareSpecialTodo(p, ['2025-05-20'], [{ from: '2020-04', pension: 300000 }, { from: '2026-07', pension: 320000 }], '2026-11-19')).toBeNull();
  });

  it('子が生まれたあとに入社した人（基準月の額がわからない）には出さない', () => {
    expect(childcareSpecialTodo({ ...p, pension: { enrolled: true, acquiredDate: '2025-06-01' } }, ['2025-05-20'], [{ from: '2025-06', pension: 300000 }, { from: '2026-07', pension: 220000 }], '2026-11-19')).toBeNull();
  });

  it('子が3歳を過ぎても、さかのぼれる2年のうちに下がった月があれば出す。2年より前だけなら出さない', () => {
    // 2028-04 まで対象。2029-11 なら 2027-11〜2028-04 が範囲
    expect(childcareSpecialTodo(p, ['2025-05-20'], history, '2029-11-19')).not.toBeNull();
    // 2030-06 なら範囲は 2028-06〜 → 3歳を過ぎていて範囲がない
    expect(childcareSpecialTodo(p, ['2025-05-20'], history, '2030-06-01')).toBeNull();
  });

  it('退職した人・厚生年金に入っていない人には出さない', () => {
    expect(childcareSpecialTodo({ ...p, retireDate: '2026-10-31' }, ['2025-05-20'], history, '2026-11-19')).toBeNull();
    expect(childcareSpecialTodo({ ...p, pension: { enrolled: false, acquiredDate: null } }, ['2025-05-20'], history, '2026-11-19')).toBeNull();
  });

  it('子の養育開始日：産休の出産日・育休の子の生年月日（実子以外は養育開始日）・扶養家族の子。介護休業や「1以外の子」は数えない', () => {
    const leave = (o: object) => ({ kind: 'childcare', birthDate: null, childBirthDate: null, childType: null, custodyStart: null, ...o });
    expect(
      childStartsOf(
        [
          leave({ kind: 'maternity', birthDate: '2025-05-20' }),
          leave({ childBirthDate: '2025-05-20', childType: 'natural' }),
          leave({ childBirthDate: '2024-01-10', childType: 'other', custodyStart: '2024-09-01' }),
          leave({ kind: 'care', childBirthDate: '2023-01-01' }),
        ],
        [
          { relationship: 'child', birthDate: '2026-02-02' },
          { relationship: 'otherChild', birthDate: '2026-03-03' },
          { relationship: 'spouse', birthDate: '1990-01-01' },
        ],
      ).sort(),
    ).toEqual(['2024-09-01', '2025-05-20', '2026-02-02']);
  });
});
