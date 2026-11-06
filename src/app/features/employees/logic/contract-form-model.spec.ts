import { Contract } from '../../../core/models/contract';
import {
  contractAt,
  contractErrors,
  contractWarnings,
  ContractFormValue,
  emptyContractForm,
  fromContractForm,
  nextContractForm,
  scheduledWageCandidate,
  toContractForm,
  weeklyMinutesOf,
} from './contract-form-model';

function partTimer(): ContractFormValue {
  return {
    ...emptyContractForm('2026-10-01'),
    employmentType: 'part',
    payType: 'hourly',
    hours: '20',
    monthlyDays: '13',
    hourlyWage: '1,200',
    scheduledWage: '104,000',
    expectedCash: '110,000',
  };
}

describe('weeklyMinutesOf：週の所定労働時間に直す（年金機構 Q&A）', () => {
  it('週はそのまま。「20」「20:00」「20.5」が読める', () => {
    expect(weeklyMinutesOf('week', '20')).toBe(1200);
    expect(weeklyMinutesOf('week', '20:30')).toBe(1230);
    expect(weeklyMinutesOf('week', '２０.５')).toBe(1230);
  });
  it('月は 52/12 で割る：月 86時間40分 → 週 20時間', () => {
    expect(weeklyMinutesOf('month', '86:40')).toBe(1200);
  });
  it('年は 52 で割る：年 1040時間 → 週 20時間', () => {
    expect(weeklyMinutesOf('year', '1040')).toBe(1200);
  });
  it('周期は週数で割った平均：4週で 80時間 → 週 20時間', () => {
    expect(weeklyMinutesOf('cycle', '80', '4')).toBe(1200);
    expect(weeklyMinutesOf('cycle', '80', '0')).toBeUndefined();
    expect(weeklyMinutesOf('cycle', '80', '')).toBeNull();
  });
  it('空は null、読めないものは undefined', () => {
    expect(weeklyMinutesOf('week', '')).toBeNull();
    expect(weeklyMinutesOf('week', 'abc')).toBeUndefined();
  });
});

describe('scheduledWageCandidate：所定内賃金の候補', () => {
  it('時給 × 週の時間 × 52 ÷ 12（切り捨て）', () => {
    // 1,200 × 20 × 52 ÷ 12 = 104,000
    expect(scheduledWageCandidate(partTimer())).toBe(104000);
    // 1,111 × 20 × 52 ÷ 12 = 96,286.66… → 96,286
    expect(scheduledWageCandidate({ ...partTimer(), hourlyWage: '1111' })).toBe(96286);
  });
  it('月で入れた時間でも週に直してから計算', () => {
    expect(scheduledWageCandidate({ ...partTimer(), hoursUnit: 'month', hours: '86:40' })).toBe(104000);
  });
  it('日給 × 月の日数', () => {
    const v = { ...partTimer(), payType: 'daily' as const, dailyWage: '8,000', monthlyDays: '12' };
    expect(scheduledWageCandidate(v)).toBe(96000);
  });
  it('月給は出さない／材料がなければ出さない', () => {
    expect(scheduledWageCandidate({ ...partTimer(), payType: 'monthly' })).toBeNull();
    expect(scheduledWageCandidate({ ...partTimer(), hourlyWage: '' })).toBeNull();
  });
});

describe('contractErrors', () => {
  it('ちゃんと入っていればエラーなし', () => {
    expect(contractErrors(partTimer())).toEqual({});
  });
  it('時給の人は時給が要る。月給の人は要らない', () => {
    expect(contractErrors({ ...partTimer(), hourlyWage: '' }).hourlyWage).toBe('wage');
    expect(contractErrors({ ...partTimer(), payType: 'monthly', hourlyWage: '' })).toEqual({});
  });
  it('週168時間を超える・日数が31を超える・終わりが始まりより前', () => {
    const e = contractErrors({ ...partTimer(), hours: '169', monthlyDays: '32', periodEnd: '2026-09-30' });
    expect(e.hours).toBe('hoursRange');
    expect(e.monthlyDays).toBe('days');
    expect(e.periodEnd).toBe('periodBeforeFrom');
  });
  it('周期の週数がないときは週数のエラーだけ出す', () => {
    const e = contractErrors({ ...partTimer(), hoursUnit: 'cycle', hours: '80', cycleWeeks: '' });
    expect(e.cycleWeeks).toBe('cycleWeeks');
    expect(e.hours).toBeUndefined();
  });
  it('入社日より前に始まる契約は注意（保存はできる）', () => {
    expect(contractWarnings(partTimer(), '2026-11-01')).toEqual(['beforeHire']);
    expect(contractWarnings(partTimer(), '2026-10-01')).toEqual([]);
  });
});

describe('fromContractForm', () => {
  it('数字に直し、給与の形に合わない単価と、期間がないときの更新は消す', () => {
    const r = fromContractForm({ ...partTimer(), dailyWage: '9000', renewal: 'expected' })!;
    expect(r.weeklyMinutes).toBe(1200);
    expect(r.hourlyWage).toBe(1200);
    expect(r.dailyWage).toBeNull();
    expect(r.scheduledWage).toBe(104000);
    expect(r.periodEnd).toBeNull();
    expect(r.renewal).toBe('none');
    expect(r.note).toBeNull();
  });
  it('期間の定めがあれば更新の見込みを残す', () => {
    const r = fromContractForm({ ...partTimer(), periodEnd: '2027-03-31', renewal: 'possible' })!;
    expect(r.renewal).toBe('possible');
  });
  it('チェックを通らなければ null', () => {
    expect(fromContractForm({ ...partTimer(), hours: '' })).toBeNull();
  });
  it('保存した形 → 画面 → 保存した形 で戻る', () => {
    const input = fromContractForm({ ...partTimer(), hoursUnit: 'month', hours: '86:40', note: ' メモ ' })!;
    expect(fromContractForm(toContractForm(input as Contract))).toEqual(input);
  });
  it('「契約が変わった」は今の契約を写して始まる日だけ変える', () => {
    const now = fromContractForm(partTimer())! as Contract;
    const next = nextContractForm(now, '2027-04-01');
    expect(next.from).toBe('2027-04-01');
    expect(next.hourlyWage).toBe('1,200');
  });
});

describe('contractAt', () => {
  it('その日に効いている契約', () => {
    const rows = [{ from: '2025-04-01' }, { from: '2026-10-01' }];
    expect(contractAt(rows, '2026-09-30')?.from).toBe('2025-04-01');
    expect(contractAt(rows, '2026-10-01')?.from).toBe('2026-10-01');
    expect(contractAt(rows, '2025-01-01')).toBeNull();
  });
});
