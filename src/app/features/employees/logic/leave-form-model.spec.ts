import { emptyLeave, Leave } from '../../../core/models/employee';
import {
  childcareEarliest,
  emptyLeaveForm,
  extensionLimits,
  filingStatus,
  fromLeaveForm,
  isWithinMonth,
  leaveErrors,
  LeaveFormValue,
  leaveWarnings,
  markFiled,
  maternityRange,
  overlaps,
  toLeaveForm,
} from './leave-form-model';

describe('maternityRange：産休にできる範囲（年金機構の記入例どおり）', () => {
  it('出産前：予定日 6/30 → 5/20〜8/25', () => {
    expect(maternityRange('2025-06-30', null, false)).toEqual({ from: '2025-05-20', to: '2025-08-25', base: '2025-06-30' });
  });
  it('予定より早く生まれた：6/12 → 5/2〜8/7（産前も出産日から数える）', () => {
    expect(maternityRange('2025-06-30', '2025-06-12', false)).toEqual({ from: '2025-05-02', to: '2025-08-07', base: '2025-06-12' });
  });
  it('予定より遅く生まれた：予定 1/1・出産 2/1 → 11/21〜3/29（産前は予定日から）', () => {
    expect(maternityRange('2026-01-01', '2026-02-01', false)).toEqual({ from: '2025-11-21', to: '2026-03-29', base: '2026-01-01' });
  });
  it('多胎は98日前から', () => {
    expect(maternityRange('2025-06-30', null, true)?.from).toBe('2025-03-25');
  });
  it('予定日も出産日もなければ null', () => {
    expect(maternityRange(null, null, false)).toBeNull();
  });
});

describe('育休の候補・上限', () => {
  it('母親が実子のために取る育休は、生年月日の翌日から57日目から', () => {
    expect(childcareEarliest('2025-08-17', 'natural', 'female')).toBe('2025-10-13'); // 記入例の開始日
    expect(childcareEarliest('2025-08-17', 'natural', 'male')).toBeNull();
    expect(childcareEarliest('2025-08-17', 'other', 'female')).toBeNull();
  });
  it('延長の上限：1歳・（プラス）1歳2か月・1歳6か月・2歳の前日', () => {
    expect(extensionLimits('2025-08-17', false)).toEqual([
      { key: 'age1', date: '2026-08-16' }, // 記入例の終了予定日
      { key: 'age1_6', date: '2027-02-16' },
      { key: 'age2', date: '2027-08-16' },
    ]);
    expect(extensionLimits('2025-08-17', true).map((x) => x.key)).toEqual(['age1', 'age1_2', 'age1_6', 'age2']);
  });
  it('月の中で始まって終わる育休か', () => {
    const l = { ...emptyLeave('paternity', '2026-07-01'), plannedEnd: '2026-07-14' };
    expect(isWithinMonth(l)).toBeTrue();
    expect(isWithinMonth({ ...l, plannedEnd: '2026-07-31' })).toBeFalse(); // 翌日が8月
  });
});

function maternity(): Leave {
  return {
    ...emptyLeave('maternity', '2025-05-20'),
    plannedEnd: '2025-08-25',
    expectedBirthDate: '2025-06-30',
  };
}

describe('filingStatus：次に出す届', () => {
  it('まだ出していなければ申出書。期限は終了日から1か月', () => {
    expect(filingStatus(maternity())).toEqual({ status: 'needApply', deadline: '2025-09-24' });
  });
  it('出した中身と同じなら済み', () => {
    expect(filingStatus(markFiled(maternity(), '2025-05-23')).status).toBe('done');
  });
  it('予定日どおりに生まれたら届は要らない。ずれたら変更届', () => {
    const filed = markFiled(maternity(), '2025-05-23');
    expect(filingStatus({ ...filed, birthDate: '2025-06-30' }).status).toBe('done');
    expect(filingStatus({ ...filed, birthDate: '2025-06-12', plannedEnd: '2025-08-07' }).status).toBe('needChange');
    // 変更届を出したら済み
    expect(filingStatus(markFiled({ ...filed, birthDate: '2025-06-12', plannedEnd: '2025-08-07' }, '2025-06-13')).status).toBe('done');
  });
  it('予定より早く終わったら終了届。予定どおりなら要らない', () => {
    const filed = markFiled(maternity(), '2025-05-23');
    expect(filingStatus({ ...filed, end: '2025-07-31' }).status).toBe('needEnd');
    expect(filingStatus({ ...filed, end: '2025-08-25' }).status).toBe('done');
  });
  it('育休：終了予定日を延ばしたら延長', () => {
    const l = markFiled({ ...emptyLeave('childcare', '2025-10-13'), plannedEnd: '2026-08-16' }, '2025-10-15');
    expect(filingStatus({ ...l, plannedEnd: '2027-02-16' }).status).toBe('needExtension');
  });
  it('介護休業・休職は届なし', () => {
    expect(filingStatus(emptyLeave('care', '2026-01-01')).status).toBe('none');
  });
});

function childcareForm(): LeaveFormValue {
  return {
    ...emptyLeaveForm('childcare'),
    start: '2025-10-13',
    plannedEnd: '2026-08-16',
    childLast: '年金',
    childFirst: '太郎',
    childLastKana: 'ネンキン',
    childFirstKana: 'タロウ',
    childBirthDate: '2025-08-17',
  };
}

describe('leaveErrors / leaveWarnings', () => {
  it('育休：子の氏名・生年月日・終了予定日が要る。養子なら養育開始日も', () => {
    expect(leaveErrors(childcareForm())).toEqual({});
    const e = leaveErrors({ ...childcareForm(), childLast: '', childBirthDate: '', plannedEnd: '', childType: 'other' });
    expect(Object.keys(e).sort()).toEqual(['childBirthDate', 'childLast', 'custodyStart', 'plannedEnd']);
  });
  it('産休：出産予定日が要る。介護休業は終了予定日がなくてもよい', () => {
    expect(leaveErrors({ ...emptyLeaveForm('maternity'), start: '2025-05-20', plannedEnd: '2025-08-25' }).expectedBirthDate).toBe('required');
    expect(leaveErrors({ ...emptyLeaveForm('care'), start: '2026-01-01' })).toEqual({});
  });
  it('就業予定日数は休業の日数を超えない', () => {
    const v = { ...childcareForm(), kind: 'paternity' as const, start: '2026-07-01', plannedEnd: '2026-07-05', workDays: '6' };
    expect(leaveErrors(v).workDays).toBe('workDaysOver');
  });
  it('注意：産休の範囲外・産後56日のうちに始まる育休・28日を超える出生時育休・2歳より後', () => {
    const m = { ...emptyLeaveForm('maternity'), start: '2025-05-01', plannedEnd: '2025-09-01', expectedBirthDate: '2025-06-30' };
    expect(leaveWarnings(m, 'female')).toEqual(['beforeMaternityRange', 'afterMaternityRange']);
    expect(leaveWarnings({ ...childcareForm(), start: '2025-10-01' }, 'female')).toEqual(['beforeChildcareStart']);
    expect(leaveWarnings({ ...childcareForm(), plannedEnd: '2027-09-01' }, 'female')).toEqual(['beyondAge2']);
    const p = { ...childcareForm(), kind: 'paternity' as const, start: '2025-08-17', plannedEnd: '2025-09-14' };
    expect(leaveWarnings(p, 'male')).toEqual(['paternityOver28']); // 29日
  });
});

describe('fromLeaveForm', () => {
  it('種類に関係しない欄は消す', () => {
    const r = fromLeaveForm({ ...childcareForm(), expectedBirthDate: '2025-06-30', multipleBirth: true }, null)!;
    expect(r.expectedBirthDate).toBeNull();
    expect(r.multipleBirth).toBeFalse();
    expect(r.child).toEqual({ last: '年金', first: '太郎', lastKana: 'ネンキン', firstKana: 'タロウ' });
    expect(r.custodyStart).toBeNull();
  });
  it('出した届の中身は引き継ぐ。種類を変えたら消す', () => {
    const base = markFiled(fromLeaveForm(childcareForm(), null)!, '2025-10-15');
    expect(fromLeaveForm({ ...childcareForm(), plannedEnd: '2027-02-16' }, base)!.filed?.plannedEnd).toBe('2026-08-16');
    expect(fromLeaveForm({ ...childcareForm(), kind: 'paternity' }, base)!.filed).toBeNull();
  });
  it('保存した形 → 画面 → 保存した形 で戻る', () => {
    const l = fromLeaveForm(childcareForm(), null)!;
    expect(fromLeaveForm(toLeaveForm(l), l)).toEqual(l);
  });
  it('重なり', () => {
    const a = { ...emptyLeave('maternity', '2025-05-20'), plannedEnd: '2025-08-07' };
    const b = { ...emptyLeave('childcare', '2025-08-08'), plannedEnd: '2026-08-16' };
    expect(overlaps(b, [a])).toBeFalse();
    expect(overlaps({ ...b, start: '2025-08-07' }, [a])).toBeTrue();
  });
});
