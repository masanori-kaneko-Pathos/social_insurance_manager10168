import type { CareExemption } from '../../../core/models/employee';
import {
  careExemptionErrors,
  careExemptionWarnings,
  careExemptMonth,
  careFilingStatus,
  careOverlaps,
  emptyCareExemptionForm,
  fromCareExemptionForm,
} from './care-exemption';
import { coverageForMonth } from './coverage';

const ex = (from: string, to: string | null): CareExemption => ({
  reason: 'overseas',
  from,
  to,
  filedOn: null,
  endFiledOn: null,
  note: null,
});

describe('careExemptMonth：介護保険料がかからない月', () => {
  it('該当した日の月から、非該当になった日の月の前月まで', () => {
    const l = [ex('2026-05-20', '2026-09-10')];
    expect(careExemptMonth(l, '2026-04')).toBeFalse();
    expect(careExemptMonth(l, '2026-05')).toBeTrue(); // 該当した月からかからない
    expect(careExemptMonth(l, '2026-08')).toBeTrue();
    expect(careExemptMonth(l, '2026-09')).toBeFalse(); // 戻った月はかかる
  });

  it('同じ月に該当して非該当になったら、その月はかかる（健保法156条2項ただし書）', () => {
    expect(careExemptMonth([ex('2026-05-03', '2026-05-28')], '2026-05')).toBeFalse();
  });

  it('終わりがなければ、ずっとかからない', () => {
    expect(careExemptMonth([ex('2026-05-20', null)], '2030-01')).toBeTrue();
  });

  it('なし・空', () => {
    expect(careExemptMonth(undefined, '2026-05')).toBeFalse();
    expect(careExemptMonth([], '2026-05')).toBeFalse();
  });
});

describe('coverageForMonth：介護の判定に適用除外を入れる', () => {
  const person = {
    birthDate: '1980-03-15', // 40歳到達 2020-03-14
    health: { enrolled: true, acquiredDate: '2015-04-01', lostDate: null },
    pension: { enrolled: true, acquiredDate: '2015-04-01', lostDate: null },
  };

  it('適用除外の月は介護だけ外れる（健保・厚年はそのまま）', () => {
    const c = coverageForMonth({ ...person, careExemptions: [ex('2026-06-01', '2027-04-01')] }, '2026-06');
    expect(c.health).toBeTrue();
    expect(c.pension).toBeTrue();
    expect(c.care).toBeFalse();
  });

  it('期間の外はかかる', () => {
    const c = coverageForMonth({ ...person, careExemptions: [ex('2026-06-01', '2027-04-01')] }, '2027-04');
    expect(c.care).toBeTrue();
  });

  it('careExemptions がない（古いデータ）なら今までどおり', () => {
    expect(coverageForMonth(person, '2026-06').care).toBeTrue();
  });
});

describe('careOverlaps：重なり', () => {
  it('重なる・重ならない', () => {
    expect(careOverlaps(ex('2026-05-01', '2026-08-01'), [ex('2026-07-01', null)])).toBeTrue();
    expect(careOverlaps(ex('2026-05-01', '2026-07-01'), [ex('2026-07-01', null)])).toBeFalse(); // 非該当の日に次が該当
    expect(careOverlaps(ex('2026-05-01', null), [ex('2020-01-01', '2021-01-01')])).toBeFalse();
  });
});

describe('careFilingStatus：届の状態', () => {
  it('該当届は出すまで needed、非該当届は非該当の日が入ってから', () => {
    expect(careFilingStatus(ex('2026-05-01', null))).toEqual({ start: 'needed', end: 'none' });
    expect(careFilingStatus({ ...ex('2026-05-01', '2026-08-01'), filedOn: '2026-05-08' })).toEqual({
      start: 'done',
      end: 'needed',
    });
  });
});

describe('フォーム', () => {
  it('該当年月日は必須', () => {
    expect(careExemptionErrors(emptyCareExemptionForm()).from).toBe('required');
  });

  it('非該当の日は該当の日より後', () => {
    const v = { ...emptyCareExemptionForm(), from: '2026-05-01', to: '2026-05-01' };
    expect(careExemptionErrors(v).to).toBe('order');
  });

  it('非該当届の日は、非該当の日がないと入れられない', () => {
    const v = { ...emptyCareExemptionForm(), from: '2026-05-01', endFiledOn: '2026-06-01' };
    expect(careExemptionErrors(v).endFiledOn).toBe('noEnd');
  });

  it('空の欄は null で保存する', () => {
    const v = { ...emptyCareExemptionForm(), reason: 'facility' as const, from: '2026-05-01', note: '  ' };
    expect(fromCareExemptionForm(v)).toEqual({
      reason: 'facility',
      from: '2026-05-01',
      to: null,
      filedOn: null,
      endFiledOn: null,
      note: null,
    });
  });

  it('40〜64歳にかかっていない期間は注意を出す', () => {
    const v = { ...emptyCareExemptionForm(), from: '2045-05-01' };
    expect(careExemptionWarnings(v, '2020-03-14', '2045-03-14')).toEqual(['outsideCareAge']);
    const w = { ...emptyCareExemptionForm(), from: '2026-05-01' };
    expect(careExemptionWarnings(w, '2020-03-14', '2045-03-14')).toEqual([]);
  });
});
